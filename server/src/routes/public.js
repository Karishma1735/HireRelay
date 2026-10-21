import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { config, setupStatus } from '../config.js'
import { one } from '../db.js'
import { verifyIngestKey } from '../lib/ingestKey.js'
import { upsertFromSubmission, logIngest } from '../lib/candidates.js'
import { registrationConfirmation } from '../lib/emails.js'
import { requestApproval, approveAndExecute } from '../lib/approvals.js'
import { getSettings } from '../lib/settings.js'

/** After a brand-new candidate: queue the confirmation email (or send it when HR enabled auto-send). */
export async function afterCandidateCreated(drive, candidate) {
  if (!candidate.email) return
  const settings = await getSettings(drive.owner_id)
  const approval = await requestApproval(drive.owner_id, {
    email: registrationConfirmation(candidate, drive), candidateId: candidate.id, requestedBy: 'system',
    title: `Registration confirmation to ${candidate.full_name}`
  })
  if (settings.auto_send_confirmations) approveAndExecute(drive.owner_id, approval.id).catch((e) => console.error('auto-send failed', e.message))
}

const registerSchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(200).optional().or(z.literal('')),
  phone: z.string().trim().max(30).optional().or(z.literal('')),
  role_applied: z.string().trim().max(120).optional(),
  experience_years: z.coerce.number().min(0).max(60).optional(),
  current_company: z.string().trim().max(120).optional(),
  website: z.string().optional() // honeypot: real people leave it empty
})

export function publicRoutes() {
  const r = Router()
  const limiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false })

  r.get('/health', (_req, res) => res.json({ ok: true }))

  // Only whether things are set, never the values.
  r.get('/config', (_req, res) => res.json({
    setup: setupStatus()
  }))

  r.get('/public/drives/:slug', async (req, res) => {
    const d = await one(`select name, role_title, venue, drive_date from drives where slug = $1 and status = 'active'`, [req.params.slug])
    if (!d) return res.status(404).json({ error: 'This registration form is closed or does not exist' })
    res.json(d)
  })

  r.post('/public/drives/:slug/register', limiter, async (req, res) => {
    const drive = await one(`select * from drives where slug = $1 and status = 'active'`, [req.params.slug])
    if (!drive) return res.status(404).json({ error: 'This registration form is closed or does not exist' })
    const body = registerSchema.parse(req.body)
    if (body.website) return res.json({ outcome: 'created' }) // silently drop bots
    const { website, ...raw } = body
    const result = await upsertFromSubmission({ drive, raw, source: 'form' })
    await logIngest(drive.owner_id, drive.id, 'form', result, raw)
    if (result.outcome === 'rejected') return res.status(422).json({ error: result.message })
    if (result.outcome === 'created') await afterCandidateCreated(drive, result.candidate)
    // Never reveal whether someone else already registered with these details.
    res.status(result.outcome === 'created' ? 201 : 200).json({ outcome: result.outcome === 'created' ? 'created' : 'already_registered' })
  })

  // Called by the viaSocket handler on every new Google Form response.
  r.post('/ingest/google-forms', async (req, res) => {
    const { drive_id: driveId, event } = z.object({ drive_id: z.string().uuid(), event: z.record(z.any()) }).parse(req.body)
    if (!verifyIngestKey(driveId, req.get('x-hirerelay-ingest-key'))) return res.status(401).json({ error: 'Invalid ingest key' })
    const drive = await one('select * from drives where id = $1', [driveId])
    if (!drive) return res.status(404).json({ error: 'Unknown drive' })
    let result
    try { result = await upsertFromSubmission({ drive, raw: event, source: 'google_forms' }) }
    catch (e) { await logIngest(drive.owner_id, drive.id, 'google_forms', { outcome: 'error', message: e.message }, event); throw e }
    await logIngest(drive.owner_id, drive.id, 'google_forms', result, event)
    if (result.outcome === 'created') await afterCandidateCreated(drive, result.candidate)
    // 200 for duplicates and rejects keeps viaSocket from retrying a payload that can never succeed.
    res.status(result.outcome === 'created' ? 201 : 200).json({ outcome: result.outcome, message: result.message, candidate_id: result.candidate?.id })
  })
  return r
}

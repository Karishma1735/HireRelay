import crypto from 'node:crypto'
import { Router } from 'express'
import { z } from 'zod'
import { one, many, query } from '../db.js'
import { slugify } from '../lib/normalize.js'
import { upsertFromSubmission, logIngest, changeStage, STAGES } from '../lib/candidates.js'
import { dashboardMetrics, waitingList, pendingFeedbackList } from '../lib/metrics.js'
import { approveAndExecute, requestApproval } from '../lib/approvals.js'
import { interviewReminder, feedbackReminder } from '../lib/emails.js'
import { afterCandidateCreated } from './public.js'

const uuid = z.string().uuid()
const opt = (s) => s.optional().nullable().or(z.literal('').transform(() => null))

export function hrRoutes() {
  const r = Router()
  const owner = (req) => req.user.id

  // ---------- drives ----------
  r.get('/drives', async (req, res) => {
    res.json(await many(
      `select d.*, count(c.id)::int as candidate_count,
              count(c.id) filter (where c.checked_in_at is not null)::int as checked_in_count,
              (select s.script_id is not null from viasocket_subscriptions s where s.drive_id = d.id and s.status = 'active' limit 1) as google_form_connected
       from drives d left join candidates c on c.drive_id = d.id
       where d.owner_id = $1 group by d.id order by d.created_at desc`, [owner(req)]))
  })

  r.post('/drives', async (req, res) => {
    const b = z.object({ name: z.string().trim().min(2).max(120), role_title: opt(z.string().max(120)), venue: opt(z.string().max(200)), drive_date: opt(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)) }).parse(req.body)
    const slug = `${slugify(b.name)}-${crypto.randomBytes(3).toString('hex')}`
    res.status(201).json(await one(
      `insert into drives (owner_id, name, role_title, venue, drive_date, slug) values ($1,$2,$3,$4,$5,$6) returning *`,
      [owner(req), b.name, b.role_title ?? null, b.venue ?? null, b.drive_date ?? null, slug]))
  })

  r.get('/drives/:id', async (req, res) => {
    const d = await one('select * from drives where id = $1 and owner_id = $2', [uuid.parse(req.params.id), owner(req)])
    if (!d) return res.status(404).json({ error: 'Drive not found' })
    const sub = await one(`select id, script_id is not null as live, input_data, created_at from viasocket_subscriptions where drive_id = $1 and status = 'active'`, [d.id])
    res.json({ ...d, google_form_subscription: sub })
  })

  r.patch('/drives/:id', async (req, res) => {
    const b = z.object({
      name: z.string().trim().min(2).max(120).optional(), role_title: opt(z.string().max(120)), venue: opt(z.string().max(200)),
      drive_date: opt(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)), status: z.enum(['active', 'closed']).optional(),
      field_map: z.record(z.string().max(200)).optional()
    }).parse(req.body)
    const d = await one('select * from drives where id = $1 and owner_id = $2', [uuid.parse(req.params.id), owner(req)])
    if (!d) return res.status(404).json({ error: 'Drive not found' })
    const m = { ...d, ...Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)) }
    res.json(await one(
      `update drives set name=$2, role_title=$3, venue=$4, drive_date=$5, status=$6, field_map=$7 where id=$1 returning *`,
      [d.id, m.name, m.role_title, m.venue, m.drive_date, m.status, m.field_map]))
  })

  // ---------- interviewers ----------
  r.get('/interviewers', async (req, res) => res.json(await many(
    `select i.*, (select count(*)::int from candidates c where c.interviewer_id = i.id and c.stage = 'in_interview') as in_interview
     from interviewers i where owner_id = $1 order by name`, [owner(req)])))
  r.post('/interviewers', async (req, res) => {
    const b = z.object({ name: z.string().trim().min(2).max(120), email: opt(z.string().email()) }).parse(req.body)
    res.status(201).json(await one(`insert into interviewers (owner_id, name, email) values ($1,$2,$3) returning *`, [owner(req), b.name, b.email ?? null]))
  })
  r.patch('/interviewers/:id', async (req, res) => {
    const b = z.object({ active: z.boolean().optional(), email: opt(z.string().email()), name: z.string().trim().min(2).optional() }).parse(req.body)
    const row = await one(
      `update interviewers set active = coalesce($3, active), email = coalesce($4, email), name = coalesce($5, name) where id = $1 and owner_id = $2 returning *`,
      [uuid.parse(req.params.id), owner(req), b.active ?? null, b.email ?? null, b.name ?? null])
    row ? res.json(row) : res.status(404).json({ error: 'Interviewer not found' })
  })

  // ---------- candidates ----------
  r.get('/candidates', async (req, res) => {
    const q = z.object({ drive_id: uuid.optional(), stage: z.enum(STAGES).optional(), q: z.string().max(100).optional(), pending_feedback: z.enum(['1']).optional(), limit: z.coerce.number().int().min(1).max(500).default(200) }).parse(req.query)
    res.json(await many(
      `select c.*, d.name as drive_name, i.name as interviewer_name, (f.id is not null) as has_feedback
       from candidates c join drives d on d.id = c.drive_id
       left join interviewers i on i.id = c.interviewer_id left join feedback f on f.candidate_id = c.id
       where c.owner_id = $1 and ($2::uuid is null or c.drive_id = $2) and ($3::text is null or c.stage = $3)
         and ($4::text is null or c.full_name ilike '%'||$4||'%' or c.email ilike '%'||$4||'%' or c.phone ilike '%'||$4||'%')
         and ($5::boolean is not true or (c.interview_completed_at is not null and f.id is null))
       order by case c.stage when 'in_interview' then 0 when 'waiting' then 1 else 2 end, c.queue_number nulls last, c.created_at desc limit $6`,
      [owner(req), q.drive_id ?? null, q.stage ?? null, q.q ?? null, q.pending_feedback === '1' ? true : null, q.limit]))
  })

  r.get('/candidates/:id', async (req, res) => {
    const c = await one(
      `select c.*, d.name as drive_name, i.name as interviewer_name from candidates c join drives d on d.id = c.drive_id
       left join interviewers i on i.id = c.interviewer_id where c.id = $1 and c.owner_id = $2`, [uuid.parse(req.params.id), owner(req)])
    if (!c) return res.status(404).json({ error: 'Candidate not found' })
    res.json({ ...c, feedback: await one('select * from feedback where candidate_id = $1', [c.id]) })
  })

  r.post('/candidates', async (req, res) => {
    const b = z.object({ drive_id: uuid, full_name: z.string().trim().min(2), email: opt(z.string().email()), phone: opt(z.string().max(30)), role_applied: opt(z.string().max(120)) }).parse(req.body)
    const drive = await one('select * from drives where id = $1 and owner_id = $2', [b.drive_id, owner(req)])
    if (!drive) return res.status(404).json({ error: 'Drive not found' })
    const { drive_id, ...raw } = b
    const result = await upsertFromSubmission({ drive, raw, source: 'manual' })
    await logIngest(owner(req), drive.id, 'manual', result, raw)
    if (result.outcome === 'rejected') return res.status(422).json({ error: result.message })
    if (result.outcome === 'duplicate') return res.status(409).json({ error: 'A candidate with this email or phone already exists in this drive', candidate: result.candidate })
    await afterCandidateCreated(drive, result.candidate)
    res.status(201).json(result.candidate)
  })

  r.post('/candidates/:id/stage', async (req, res) => {
    const b = z.object({ stage: z.enum(STAGES), interviewer_id: uuid.optional() }).parse(req.body)
    const out = await changeStage(owner(req), uuid.parse(req.params.id), b.stage, { interviewerId: b.interviewer_id })
    out.error ? res.status(out.status).json({ error: out.error }) : res.json(out.candidate)
  })

  r.patch('/candidates/:id/interviewer', async (req, res) => {
    const { interviewer_id } = z.object({ interviewer_id: uuid.nullable() }).parse(req.body)
    if (interviewer_id && !(await one('select 1 from interviewers where id = $1 and owner_id = $2', [interviewer_id, owner(req)]))) return res.status(404).json({ error: 'Interviewer not found' })
    const row = await one('update candidates set interviewer_id = $3, updated_at = now() where id = $1 and owner_id = $2 returning *', [uuid.parse(req.params.id), owner(req), interviewer_id])
    row ? res.json(row) : res.status(404).json({ error: 'Candidate not found' })
  })

  r.post('/candidates/:id/feedback', async (req, res) => {
    const b = z.object({ rating: z.coerce.number().int().min(1).max(5), recommendation: z.enum(['hire', 'hold', 'reject']), notes: opt(z.string().max(4000)) }).parse(req.body)
    const c = await one('select * from candidates where id = $1 and owner_id = $2', [uuid.parse(req.params.id), owner(req)])
    if (!c) return res.status(404).json({ error: 'Candidate not found' })
    if (!c.interview_completed_at) return res.status(409).json({ error: 'Feedback can be recorded after the interview is completed' })
    try {
      res.status(201).json(await one(
        `insert into feedback (owner_id, candidate_id, interviewer_id, rating, recommendation, notes) values ($1,$2,$3,$4,$5,$6) returning *`,
        [owner(req), c.id, c.interviewer_id, b.rating, b.recommendation, b.notes ?? null]))
    } catch (e) { if (e.code === '23505') return res.status(409).json({ error: 'Feedback already recorded' }); throw e }
  })

  // ---------- dashboard ----------
  r.get('/dashboard', async (req, res) => {
    const driveId = req.query.drive_id ? uuid.parse(req.query.drive_id) : null
    if (driveId && !(await one('select 1 from drives where id = $1 and owner_id = $2', [driveId, owner(req)]))) return res.status(404).json({ error: 'Drive not found' })
    const [metrics, waiting, pending, recentSync, recentRuns] = await Promise.all([
      dashboardMetrics(owner(req), driveId), waitingList(owner(req), driveId, 20), pendingFeedbackList(owner(req), driveId, 20),
      many(`select e.id, e.source, e.outcome, e.message, e.created_at, c.full_name from ingest_events e left join candidates c on c.id = e.candidate_id
            where e.owner_id = $1 and ($2::uuid is null or e.drive_id = $2) order by e.created_at desc limit 8`, [owner(req), driveId]),
      many(`select id, kind, status, error, started_at, finished_at from workflow_runs where owner_id = $1 order by started_at desc limit 8`, [owner(req)])
    ])
    res.json({ metrics, waiting, pending_feedback: pending, recent_sync: recentSync, recent_runs: recentRuns })
  })

  // ---------- approvals & runs ----------
  r.get('/approvals', async (req, res) => {
    const status = z.enum(['pending', 'approved', 'rejected', 'executed', 'failed']).optional().parse(req.query.status)
    res.json(await many(
      `select a.*, c.full_name as candidate_name from approvals a left join candidates c on c.id = a.candidate_id
       where a.owner_id = $1 and ($2::text is null or a.status = $2) order by a.created_at desc limit 200`, [owner(req), status ?? null]))
  })
  r.post('/approvals/:id/approve', async (req, res) => {
    const out = await approveAndExecute(owner(req), uuid.parse(req.params.id))
    out ? res.json(out) : res.status(409).json({ error: 'Approval not found or already decided' })
  })
  r.post('/approvals/:id/reject', async (req, res) => {
    const row = await one(`update approvals set status = 'rejected', decided_at = now() where id = $1 and owner_id = $2 and status = 'pending' returning *`, [uuid.parse(req.params.id), owner(req)])
    row ? res.json(row) : res.status(409).json({ error: 'Approval not found or already decided' })
  })
  r.post('/approvals/approve-all', async (req, res) => {
    const pending = await many(`select id from approvals where owner_id = $1 and status = 'pending' order by created_at limit 100`, [owner(req)])
    const results = []
    for (const p of pending) { const o = await approveAndExecute(owner(req), p.id); if (o) results.push(o.status) }
    res.json({ attempted: results.length, executed: results.filter((s) => s === 'executed').length, failed: results.filter((s) => s === 'failed').length })
  })

  r.post('/actions/prepare', async (req, res) => {
    const b = z.object({ type: z.enum(['interview_reminders', 'feedback_reminders']), drive_id: uuid.optional() }).parse(req.body)
    const created = []
    const pendingFor = (purpose, candidateId, to) => one(
      `select 1 from approvals where owner_id = $1 and status = 'pending' and purpose = $2 and (candidate_id = $3 or ($3 is null and payload->>'to' = $4))`,
      [owner(req), purpose, candidateId, to])
    if (b.type === 'interview_reminders') {
      const rows = await many(
        `select c.*, row_to_json(d) as drive from candidates c join drives d on d.id = c.drive_id
         where c.owner_id = $1 and c.stage = 'waiting' and c.email is not null and ($2::uuid is null or c.drive_id = $2)`, [owner(req), b.drive_id ?? null])
      for (const c of rows) {
        if (await pendingFor('interview_reminder', c.id, null)) continue
        created.push(await requestApproval(owner(req), { email: interviewReminder(c, c.drive), candidateId: c.id, requestedBy: 'hr', title: `Interview reminder to ${c.full_name}` }))
      }
    } else {
      const byInterviewer = new Map()
      for (const p of await pendingFeedbackList(owner(req), b.drive_id ?? null, 500)) {
        if (!p.interviewer_email) continue
        byInterviewer.set(p.interviewer_id, { iv: { name: p.interviewer, email: p.interviewer_email }, items: [...(byInterviewer.get(p.interviewer_id)?.items || []), p] })
      }
      for (const { iv, items } of byInterviewer.values()) {
        if (await pendingFor('feedback_reminder', null, iv.email)) continue
        created.push(await requestApproval(owner(req), { email: feedbackReminder(iv, items), requestedBy: 'hr', title: `Feedback reminder to ${iv.name} (${items.length} pending)` }))
      }
    }
    res.status(201).json({ created: created.length, approvals: created })
  })

  r.get('/runs', async (req, res) => res.json(await many(
    `select w.*, a.title from workflow_runs w left join approvals a on a.id = w.approval_id where w.owner_id = $1 order by w.started_at desc limit 100`, [owner(req)])))
  r.get('/ingest-events', async (req, res) => res.json(await many(
    `select e.*, c.full_name from ingest_events e left join candidates c on c.id = e.candidate_id where e.owner_id = $1 order by e.created_at desc limit 100`, [owner(req)])))

  // ---------- settings ----------
  r.get('/settings', async (req, res) => res.json((await one('select auto_send_confirmations from settings where owner_id = $1', [owner(req)])) || { auto_send_confirmations: false }))
  r.put('/settings', async (req, res) => {
    const b = z.object({ auto_send_confirmations: z.boolean() }).parse(req.body)
    res.json(await one(`insert into settings (owner_id, auto_send_confirmations) values ($1,$2) on conflict (owner_id) do update set auto_send_confirmations = $2 returning auto_send_confirmations`, [owner(req), b.auto_send_confirmations]))
  })
  return r
}

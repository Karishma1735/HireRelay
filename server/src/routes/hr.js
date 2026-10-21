import crypto from 'node:crypto'
import { Router } from 'express'
import { z } from 'zod'
import { one, many, query } from '../db.js'
import { slugify } from '../lib/normalize.js'
import { upsertFromSubmission, logIngest, changeStage, STAGES } from '../lib/candidates.js'
import { dashboardMetrics, waitingList, pendingFeedbackList } from '../lib/metrics.js'
import { approveAndExecute, requestApproval, retry } from '../lib/approvals.js'
import { interviewReminder, feedbackReminder } from '../lib/emails.js'
import { afterCandidateCreated } from './public.js'
import { getSettings } from '../lib/settings.js'
import { notifyQueued } from '../lib/queue.js'

const uuid = z.string().uuid()
const opt = (s) => s.optional().nullable().or(z.literal('').transform(() => null))

export function hrRoutes() {
  const r = Router()
  const owner = (req) => req.user.id

  // ---------- drives ----------
  r.get('/drives', async (req, res) => {
    res.json(await many(
      `select d.*, count(c.id) as candidate_count,
              count(c.id) filter (where c.checked_in_at is not null) as checked_in_count,
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
  // Same live numbers for every interviewer, computed from the candidates they are assigned to.
  const INTERVIEWER_STATS = `
    (select count(*) from candidates c where c.interviewer_id = i.id) as assigned,
    (select count(*) from candidates c where c.interviewer_id = i.id and c.stage = 'waiting') as waiting,
    (select count(*) from candidates c where c.interviewer_id = i.id and c.stage = 'in_interview') as in_interview,
    (select count(*) from candidates c where c.interviewer_id = i.id and c.interview_completed_at is not null) as interviewed,
    (select count(*) from candidates c left join feedback f on f.candidate_id = c.id
       where c.interviewer_id = i.id and c.interview_completed_at is not null and f.id is null) as feedback_due`
  r.get('/interviewers', async (req, res) => res.json(await many(
    `select i.*, ${INTERVIEWER_STATS} from interviewers i where i.owner_id = $1 order by i.active desc, i.name`, [owner(req)])))
  r.get('/interviewers/:id', async (req, res) => {
    const row = await one(`select i.*, ${INTERVIEWER_STATS} from interviewers i where i.id = $1 and i.owner_id = $2`, [uuid.parse(req.params.id), owner(req)])
    row ? res.json(row) : res.status(404).json({ error: 'Interviewer not found' })
  })
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
    const q = z.object({ drive_id: uuid.optional(), interviewer_id: uuid.optional(), stage: z.enum(STAGES).optional(), q: z.string().max(100).optional(), pending_feedback: z.enum(['1']).optional(), limit: z.coerce.number().int().min(1).max(500).default(200) }).parse(req.query)
    res.json(await many(
      `select c.*, d.name as drive_name, i.name as interviewer_name, (f.id is not null) as has_feedback
       from candidates c join drives d on d.id = c.drive_id
       left join interviewers i on i.id = c.interviewer_id left join feedback f on f.candidate_id = c.id
       where c.owner_id = $1 and ($2 is null or c.drive_id = $2) and ($3 is null or c.stage = $3) and ($7 is null or c.interviewer_id = $7)
         and ($4 is null or c.full_name like '%'||$4||'%' or c.email like '%'||$4||'%' or c.phone like '%'||$4||'%')
         and ($5 is null or (c.interview_completed_at is not null and f.id is null))
       order by case c.stage when 'in_interview' then 0 when 'waiting' then 1 else 2 end, c.queue_number nulls last, c.created_at desc limit $6`,
      [owner(req), q.drive_id ?? null, q.stage ?? null, q.q ?? null, q.pending_feedback === '1' ? true : null, q.limit, q.interviewer_id ?? null]))
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

  // Deleting a candidate also drops their feedback and any email still waiting for approval.
  const deleteCandidates = async (ownerId, ids) => {
    let deleted = 0
    for (const id of ids) {
      if (!(await one('select 1 from candidates where id = $1 and owner_id = $2', [id, ownerId]))) continue
      await query(`delete from approvals where owner_id = $1 and candidate_id = $2 and status = 'pending'`, [ownerId, id])
      await query('delete from ingest_events where candidate_id = $1 and owner_id = $2', [id, ownerId])
      await query('delete from candidates where id = $1 and owner_id = $2', [id, ownerId]); deleted++
    }
    return deleted
  }
  r.delete('/candidates/:id', async (req, res) => {
    const n = await deleteCandidates(owner(req), [uuid.parse(req.params.id)])
    n ? res.json({ deleted: n }) : res.status(404).json({ error: 'Candidate not found' })
  })
  r.post('/candidates/delete', async (req, res) => {
    const { ids } = z.object({ ids: z.array(uuid).min(1).max(500) }).parse(req.body)
    res.json({ deleted: await deleteCandidates(owner(req), ids) })
  })

  r.post('/candidates/:id/stage', async (req, res) => {
    const b = z.object({ stage: z.enum(STAGES), interviewer_id: uuid.optional() }).parse(req.body)
    const out = await changeStage(owner(req), uuid.parse(req.params.id), b.stage, { interviewerId: b.interviewer_id, autoQueue: (await getSettings(owner(req))).auto_queue_on_check_in })
    if (out.error) return res.status(out.status).json({ error: out.error })
    // Entering the queue (automatically at check-in, or by Add to queue) tells the candidate their number.
    if (out.candidate.stage === 'waiting' && ['registered', 'checked_in'].includes(out.prev)) await notifyQueued(owner(req), out.candidate)
    res.json(out.candidate)
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

  // A sync event belongs on screen only while its candidate exists; rejected/error events never had one.
  const LIVE_EVENTS = `(e.candidate_id is not null or e.outcome in ('rejected','error'))`

  // ---------- dashboard ----------
  r.get('/dashboard', async (req, res) => {
    const driveId = req.query.drive_id ? uuid.parse(req.query.drive_id) : null
    if (driveId && !(await one('select 1 from drives where id = $1 and owner_id = $2', [driveId, owner(req)]))) return res.status(404).json({ error: 'Drive not found' })
    const [metrics, waiting, pending, recentSync] = await Promise.all([
      dashboardMetrics(owner(req), driveId), waitingList(owner(req), driveId, 20), pendingFeedbackList(owner(req), driveId, 20),
      many(`select e.id, e.source, e.outcome, e.message, e.created_at, c.full_name from ingest_events e left join candidates c on c.id = e.candidate_id
            where e.owner_id = $1 and ($2 is null or e.drive_id = $2) and ${LIVE_EVENTS} order by e.created_at desc limit 8`, [owner(req), driveId])
    ])
    res.json({ metrics, waiting, pending_feedback: pending, recent_sync: recentSync })
  })

  // ---------- approvals & runs ----------
  r.get('/approvals', async (req, res) => {
    const status = z.enum(['pending', 'approved', 'rejected', 'executed', 'failed']).optional().parse(req.query.status)
    res.json(await many(
      `select a.*, c.full_name as candidate_name from approvals a left join candidates c on c.id = a.candidate_id
       where a.owner_id = $1 and ($2 is null or a.status = $2) order by a.created_at desc limit 200`, [owner(req), status ?? null]))
  })
  r.post('/approvals/:id/approve', async (req, res) => {
    const out = await approveAndExecute(owner(req), uuid.parse(req.params.id))
    out ? res.json(out) : res.status(409).json({ error: 'Approval not found or already decided' })
  })
  r.post('/approvals/:id/retry', async (req, res) => {
    const out = await retry(owner(req), uuid.parse(req.params.id))
    out ? res.json(out) : res.status(409).json({ error: 'Only a sent or failed approval can be sent again' })
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
        `select c.*, json_object('name', d.name, 'role_title', d.role_title, 'venue', d.venue, 'drive_date', d.drive_date) as drive from candidates c join drives d on d.id = c.drive_id
         where c.owner_id = $1 and c.stage = 'waiting' and c.email is not null and ($2 is null or c.drive_id = $2)`, [owner(req), b.drive_id ?? null])
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
    `select e.*, c.full_name from ingest_events e left join candidates c on c.id = e.candidate_id where e.owner_id = $1 and ${LIVE_EVENTS} order by e.created_at desc limit 100`, [owner(req)])))

  // ---------- settings ----------
  r.get('/settings', async (req, res) => res.json(await getSettings(owner(req))))
  r.put('/settings', async (req, res) => {
    const b = z.object({ auto_send_confirmations: z.boolean().optional(), auto_queue_on_check_in: z.boolean().optional(), auto_send_queue_emails: z.boolean().optional() }).parse(req.body)
    const cur = { ...(await getSettings(owner(req))), ...b }
    await query(
      `insert into settings (owner_id, auto_send_confirmations, auto_queue_on_check_in, auto_send_queue_emails) values ($1,$2,$3,$4)
       on conflict (owner_id) do update set auto_send_confirmations = $2, auto_queue_on_check_in = $3, auto_send_queue_emails = $4`,
      [owner(req), cur.auto_send_confirmations, cur.auto_queue_on_check_in, cur.auto_send_queue_emails])
    res.json(cur)
  })
  return r
}

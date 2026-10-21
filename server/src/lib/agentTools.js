import { z } from 'zod'
import { one, many } from '../db.js'
import { STAGES } from './candidates.js'
import { dashboardMetrics } from './metrics.js'

/**
 * Read-only lookups the AI agent may call while answering. Each tool is scoped to one HR user (`ownerId`) and
 * returns compact rows so a large drive does not flood the model. Nothing here changes data.
 */
const limit = (n = 20, max = 50) => z.coerce.number().int().min(1).max(max).default(n)
const text = z.string().trim().max(120).optional().transform((v) => v || undefined)
const like = (v) => (v ? `%${v.replace(/[%_]/g, '')}%` : null)

const CAND_COLS = `c.id, c.full_name as name, c.email, c.phone, c.role_applied as role, c.experience_years, c.current_company as company,
  c.stage, c.queue_number, c.source, d.name as drive, i.name as interviewer, c.created_at as registered_at, c.checked_in_at,
  c.interview_started_at, c.interview_completed_at, c.updated_at as last_changed_at, f.rating, f.recommendation, (f.id is not null) as has_feedback`
const CAND_FROM = `from candidates c join drives d on d.id = c.drive_id left join interviewers i on i.id = c.interviewer_id left join feedback f on f.candidate_id = c.id`

export const TOOLS = {
  get_overview: {
    description: 'Overall counts for this hiring account: candidates by stage, waiting, in interview, interviewed, feedback due, pending approvals, average wait and interview time. Use for "how many" questions and as a starting point.',
    fields: {}, required: [], schema: z.object({}),
    run: async (ownerId) => {
      const m = await dashboardMetrics(ownerId)
      const drives = await one('select count(*) as n from drives where owner_id = $1', [ownerId])
      const ivs = await one('select count(*) as n from interviewers where owner_id = $1 and active = 1', [ownerId])
      return { totals: { candidates: m.total, registered: m.registered, checked_in: m.checked_in, waiting: m.waiting, in_interview: m.in_interview, interviewed: m.completed, feedback_due: m.pending_feedback }, by_stage: m.stages, drives: drives.n, active_interviewers: ivs.n, emails_awaiting_approval: m.pending_approvals, average_wait_minutes: m.avg_wait_min, average_interview_minutes: m.avg_interview_min }
    }
  },

  search_candidates: {
    description: 'Find candidates by any combination of name/email/phone text, stage, drive, interviewer, source, registration date or feedback status. Returns the matching candidates (newest change first by default) and the total count. Use it for "who is ...", "latest rejected candidate", "who is waiting", "candidates from the Pune drive", "who has no interviewer".',
    fields: {
      query: { type: 'string', description: 'Part of the name, email or phone number' },
      stage: { type: 'string', description: `One of: ${STAGES.join(', ')}` },
      drive: { type: 'string', description: 'Part of the hiring drive name' },
      interviewer: { type: 'string', description: 'Part of the interviewer name, or "none" for candidates with no interviewer' },
      source: { type: 'string', description: 'One of: form (registration link), google_forms, manual' },
      registered_since: { type: 'string', description: 'Only candidates registered on or after this date, YYYY-MM-DD' },
      feedback: { type: 'string', description: 'pending (interview done, no feedback yet), given, or any' },
      sort: { type: 'string', description: 'recent (latest change first, default), oldest (earliest registration first), or queue (queue number order)' },
      limit: { type: 'number', description: 'How many to return, 1-50 (default 20)' }
    },
    required: [],
    schema: z.object({ query: text, stage: z.enum(STAGES).optional().or(z.literal('').transform(() => undefined)), drive: text, interviewer: text, source: z.enum(['form', 'google_forms', 'manual']).optional().or(z.literal('').transform(() => undefined)),
      registered_since: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional().or(z.literal('').transform(() => undefined)), feedback: z.enum(['pending', 'given', 'any']).optional().or(z.literal('').transform(() => undefined)),
      sort: z.enum(['recent', 'oldest', 'queue']).optional().or(z.literal('').transform(() => undefined)), limit: limit() }),
    run: async (ownerId, a) => {
      const noIv = a.interviewer && a.interviewer.toLowerCase() === 'none'
      const where = `where c.owner_id = $1 and ($2 is null or c.full_name like $2 or c.email like $2 or c.phone like $2) and ($3 is null or c.stage = $3)
        and ($4 is null or d.name like $4) and ($5 is null or i.name like $5) and ($6 = 0 or c.interviewer_id is null) and ($7 is null or c.source = $7)
        and ($8 is null or c.created_at >= $8)
        and ($9 is null or $9 = 'any' or ($9 = 'given' and f.id is not null) or ($9 = 'pending' and c.interview_completed_at is not null and f.id is null))`
      const params = [ownerId, like(a.query), a.stage ?? null, like(a.drive), noIv ? null : like(a.interviewer), noIv ? 1 : 0, a.source ?? null, a.registered_since ?? null, a.feedback ?? null]
      const order = { recent: 'c.updated_at desc', oldest: 'c.created_at asc', queue: 'c.queue_number is null, c.queue_number' }[a.sort || 'recent']
      const rows = await many(`select ${CAND_COLS} ${CAND_FROM} ${where} order by ${order} limit ${a.limit}`, params)
      const { n } = await one(`select count(*) as n ${CAND_FROM} ${where}`, params)
      return { total_matching: n, returned: rows.length, candidates: rows }
    }
  },

  get_candidate: {
    description: 'Everything about one candidate: profile, all form answers, stage and timestamps, interviewer, interview feedback (rating, recommendation, notes), and the emails sent or queued for them. Give a candidate_id (from search_candidates) or a name.',
    fields: { candidate_id: { type: 'string', description: 'The candidate id from search_candidates' }, name: { type: 'string', description: 'Part of the candidate name, if no id is known' } },
    required: [],
    schema: z.object({ candidate_id: text, name: text }),
    run: async (ownerId, a) => {
      let matches = a.candidate_id ? await many('select id from candidates where owner_id = $1 and id = $2', [ownerId, a.candidate_id]) : []
      if (!matches.length && a.name) matches = await many('select id from candidates where owner_id = $1 and full_name like $2 order by updated_at desc limit 5', [ownerId, like(a.name)])
      if (!matches.length) return { found: false, message: 'No candidate matches that.' }
      if (matches.length > 1) return { found: false, message: 'Several candidates match; ask which one.', matches: await many(`select ${CAND_COLS} ${CAND_FROM} where c.owner_id = $1 and c.id in (${matches.map((_, i) => `$${i + 2}`).join(',')})`, [ownerId, ...matches.map((m) => m.id)]) }
      const id = matches[0].id
      const c = await one(`select ${CAND_COLS}, c.extra ${CAND_FROM} where c.owner_id = $1 and c.id = $2`, [ownerId, id])
      const feedback = await one('select rating, recommendation, notes, created_at from feedback where candidate_id = $1', [id])
      const emails = await many('select title, status, error, requested_by, created_at from approvals where owner_id = $1 and candidate_id = $2 order by created_at desc limit 10', [ownerId, id])
      return { found: true, candidate: c, feedback, emails }
    }
  },

  list_feedback: {
    description: 'Interview feedback that has been recorded: candidate, interviewer, rating 1-5, hire/hold/reject recommendation and notes. Filter by recommendation, interviewer or drive.',
    fields: { recommendation: { type: 'string', description: 'hire, hold or reject' }, interviewer: { type: 'string', description: 'Part of the interviewer name' }, drive: { type: 'string', description: 'Part of the drive name' }, limit: { type: 'number', description: '1-50, default 20' } },
    required: [],
    schema: z.object({ recommendation: z.enum(['hire', 'hold', 'reject']).optional().or(z.literal('').transform(() => undefined)), interviewer: text, drive: text, limit: limit() }),
    run: async (ownerId, a) => ({ feedback: await many(
      `select c.full_name as candidate, c.id as candidate_id, d.name as drive, i.name as interviewer, f.rating, f.recommendation, f.notes, f.created_at
       from feedback f join candidates c on c.id = f.candidate_id join drives d on d.id = c.drive_id left join interviewers i on i.id = f.interviewer_id
       where f.owner_id = $1 and ($2 is null or f.recommendation = $2) and ($3 is null or i.name like $3) and ($4 is null or d.name like $4)
       order by f.created_at desc limit ${a.limit}`, [ownerId, a.recommendation ?? null, like(a.interviewer), like(a.drive)]) })
  },

  list_drives: {
    description: 'All hiring drives with their date, venue, status and how many candidates are in each stage.',
    fields: {}, required: [], schema: z.object({}),
    run: async (ownerId) => ({ drives: await many(
      `select d.name, d.role_title, d.venue, d.drive_date, d.status, count(c.id) as candidates,
         count(c.id) filter (where c.stage = 'registered') as registered, count(c.id) filter (where c.checked_in_at is not null) as checked_in,
         count(c.id) filter (where c.stage = 'waiting') as waiting, count(c.id) filter (where c.stage = 'in_interview') as in_interview,
         count(c.id) filter (where c.interview_completed_at is not null) as interviewed, count(c.id) filter (where c.stage = 'selected') as selected,
         count(c.id) filter (where c.stage = 'rejected') as rejected
       from drives d left join candidates c on c.drive_id = d.id where d.owner_id = $1 group by d.id order by d.created_at desc`, [ownerId]) })
  },

  list_interviewers: {
    description: 'Interviewers with their workload: candidates assigned, waiting, in interview now, interviewed, and feedback still owed.',
    fields: {}, required: [], schema: z.object({}),
    run: async (ownerId) => ({ interviewers: await many(
      `select i.name, i.email, i.active,
         (select count(*) from candidates c where c.interviewer_id = i.id) as assigned,
         (select count(*) from candidates c where c.interviewer_id = i.id and c.stage = 'waiting') as waiting,
         (select count(*) from candidates c where c.interviewer_id = i.id and c.stage = 'in_interview') as in_interview,
         (select count(*) from candidates c where c.interviewer_id = i.id and c.interview_completed_at is not null) as interviewed,
         (select count(*) from candidates c left join feedback f on f.candidate_id = c.id where c.interviewer_id = i.id and c.interview_completed_at is not null and f.id is null) as feedback_owed
       from interviewers i where i.owner_id = $1 order by i.active desc, i.name`, [ownerId]) })
  },

  list_emails: {
    description: 'Emails HireRelay prepared or sent: who they are for, what they are, whether they are pending approval, sent (executed), failed (with the reason) or rejected.',
    fields: { status: { type: 'string', description: 'pending, executed, failed or rejected' }, candidate: { type: 'string', description: 'Part of the candidate name' }, limit: { type: 'number', description: '1-50, default 20' } },
    required: [],
    schema: z.object({ status: z.enum(['pending', 'approved', 'executed', 'failed', 'rejected']).optional().or(z.literal('').transform(() => undefined)), candidate: text, limit: limit() }),
    run: async (ownerId, a) => ({ emails: await many(
      `select a.title, json_extract(a.payload, '$.to') as to_address, json_extract(a.payload, '$.subject') as subject, a.status, a.error, a.requested_by, a.created_at, c.full_name as candidate
       from approvals a left join candidates c on c.id = a.candidate_id
       where a.owner_id = $1 and ($2 is null or a.status = $2) and ($3 is null or c.full_name like $3) order by a.created_at desc limit ${a.limit}`, [ownerId, a.status ?? null, like(a.candidate)]) })
  },

  recent_activity: {
    description: 'The most recent registrations received (registration link, Google Form or added by hand) and what happened to each: new, duplicate or rejected.',
    fields: { limit: { type: 'number', description: '1-50, default 15' } }, required: [], schema: z.object({ limit: limit(15) }),
    run: async (ownerId, a) => ({ activity: await many(
      `select e.created_at, e.source, e.outcome, e.message, c.full_name as candidate from ingest_events e left join candidates c on c.id = e.candidate_id
       where e.owner_id = $1 and (e.candidate_id is not null or e.outcome in ('rejected','error')) order by e.created_at desc limit ${a.limit}`, [ownerId]) })
  }
}

/** The tool descriptions in viaSocket's `extra_tools` format. Every call carries a short-lived token for this user. */
export function toolDefinitions(baseUrl, token) {
  return Object.entries(TOOLS).map(([name, t]) => ({
    name, description: t.description, url: `${baseUrl}/api/agent-tools/${name}`, method: 'POST',
    headers: { Authorization: `Bearer ${token}` }, fields: t.fields, required_params: t.required, tool_and_variable_path: {}
  }))
}

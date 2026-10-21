import { one, many } from '../db.js'

/** Every number is computed from the candidates table at request time. Nothing is cached or hardcoded. */
export async function dashboardMetrics(ownerId, driveId = null) {
  const scope = 'and ($2::uuid is null or c.drive_id = $2)'
  const p = [ownerId, driveId]
  const totals = await one(
    `select
       count(*)::int as total,
       count(*) filter (where c.stage = 'registered')::int as registered,
       count(*) filter (where c.checked_in_at is not null)::int as checked_in,
       count(*) filter (where c.stage = 'waiting')::int as waiting,
       count(*) filter (where c.stage = 'in_interview')::int as in_interview,
       count(*) filter (where c.interview_completed_at is not null)::int as completed,
       count(*) filter (where c.interview_completed_at is not null and f.id is null)::int as pending_feedback
     from candidates c left join feedback f on f.candidate_id = c.id
     where c.owner_id = $1 ${scope}`, p)
  const stages = await many(
    `select c.stage, count(*)::int as count from candidates c where c.owner_id = $1 ${scope} group by c.stage`, p)
  const runs = await many(
    `select status, count(*)::int as count from workflow_runs where owner_id = $1 group by status`, [ownerId])
  const approvals = await one(`select count(*)::int as pending from approvals where owner_id = $1 and status = 'pending'`, [ownerId])
  const lastSync = await one(
    `select created_at, outcome, source from ingest_events where owner_id = $1 and ($2::uuid is null or drive_id = $2) order by created_at desc limit 1`, p)
  return {
    ...totals,
    stages: Object.fromEntries(stages.map((s) => [s.stage, s.count])),
    workflow_runs: Object.fromEntries(runs.map((r) => [r.status, r.count])),
    pending_approvals: approvals.pending,
    last_sync: lastSync
  }
}

export const waitingList = (ownerId, driveId = null, limit = 50) => many(
  `select c.id, c.full_name, c.role_applied, c.queue_number, c.checked_in_at, c.updated_at, c.drive_id, i.name as interviewer
   from candidates c left join interviewers i on i.id = c.interviewer_id
   where c.owner_id = $1 and c.stage = 'waiting' and ($2::uuid is null or c.drive_id = $2)
   order by c.queue_number nulls last limit $3`, [ownerId, driveId, limit])

export const pendingFeedbackList = (ownerId, driveId = null, limit = 50) => many(
  `select c.id, c.full_name, c.email, c.role_applied, c.interview_completed_at, c.drive_id,
          i.id as interviewer_id, i.name as interviewer, i.email as interviewer_email
   from candidates c
   left join feedback f on f.candidate_id = c.id
   left join interviewers i on i.id = c.interviewer_id
   where c.owner_id = $1 and c.interview_completed_at is not null and f.id is null and ($2::uuid is null or c.drive_id = $2)
   order by c.interview_completed_at limit $3`, [ownerId, driveId, limit])

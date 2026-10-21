import { one, many } from '../db.js'

/** Every number is computed from the candidates table at request time. Nothing is cached or hardcoded. */
export async function dashboardMetrics(ownerId, driveId = null) {
  const scope = 'and ($2 is null or c.drive_id = $2)'
  const p = [ownerId, driveId]
  const totals = await one(
    `select
       count(*) as total,
       count(*) filter (where c.stage = 'registered') as registered,
       count(*) filter (where c.checked_in_at is not null) as checked_in,
       count(*) filter (where c.stage = 'waiting') as waiting,
       count(*) filter (where c.stage = 'in_interview') as in_interview,
       count(*) filter (where c.interview_completed_at is not null) as completed,
       count(*) filter (where c.interview_completed_at is not null and f.id is null) as pending_feedback
     from candidates c left join feedback f on f.candidate_id = c.id
     where c.owner_id = $1 ${scope}`, p)
  const stages = await many(
    `select c.stage, count(*) as count from candidates c where c.owner_id = $1 ${scope} group by c.stage`, p)
  const runs = await many(
    `select status, count(*) as count from workflow_runs where owner_id = $1 group by status`, [ownerId])
  const approvals = await one(`select count(*) as pending from approvals where owner_id = $1 and status = 'pending'`, [ownerId])
  // Average minutes people in the queue have been waiting right now, and how long finished interviews took.
  const timing = await one(
    `select avg((julianday('now') - julianday(c.checked_in_at)) * 1440) filter (where c.stage = 'waiting' and c.checked_in_at is not null) as avg_wait_min,
            avg((julianday(c.interview_completed_at) - julianday(c.interview_started_at)) * 1440) filter (where c.interview_completed_at is not null and c.interview_started_at is not null) as avg_interview_min
     from candidates c where c.owner_id = $1 ${scope}`, p)
  const lastSync = await one(
    `select created_at, outcome, source from ingest_events where owner_id = $1 and ($2 is null or drive_id = $2) order by created_at desc limit 1`, p)
  return {
    ...totals,
    stages: Object.fromEntries(stages.map((s) => [s.stage, s.count])),
    workflow_runs: Object.fromEntries(runs.map((r) => [r.status, r.count])),
    pending_approvals: approvals.pending,
    avg_wait_min: timing.avg_wait_min == null ? null : Math.round(timing.avg_wait_min),
    avg_interview_min: timing.avg_interview_min == null ? null : Math.round(timing.avg_interview_min),
    last_sync: lastSync
  }
}

export const waitingList = (ownerId, driveId = null, limit = 50) => many(
  `select c.id, c.full_name, c.role_applied, c.queue_number, c.checked_in_at, c.updated_at, c.drive_id, i.name as interviewer
   from candidates c left join interviewers i on i.id = c.interviewer_id
   where c.owner_id = $1 and c.stage = 'waiting' and ($2 is null or c.drive_id = $2)
   order by c.queue_number nulls last limit $3`, [ownerId, driveId, limit])

export const pendingFeedbackList = (ownerId, driveId = null, limit = 50) => many(
  `select c.id, c.full_name, c.email, c.role_applied, c.interview_completed_at, c.drive_id,
          i.id as interviewer_id, i.name as interviewer, i.email as interviewer_email
   from candidates c
   left join feedback f on f.candidate_id = c.id
   left join interviewers i on i.id = c.interviewer_id
   where c.owner_id = $1 and c.interview_completed_at is not null and f.id is null and ($2 is null or c.drive_id = $2)
   order by c.interview_completed_at limit $3`, [ownerId, driveId, limit])

/** Registrations per day for the last `days` days (UTC), zero-filled so a quiet day is a visible dip, not a gap. */
export async function registrationsTimeline(ownerId, driveId = null, days = 14) {
  const rows = await many(
    `select substr(c.created_at, 1, 10) as day, count(*) as n from candidates c
     where c.owner_id = $1 and ($2 is null or c.drive_id = $2) and c.created_at >= $3 group by day`,
    [ownerId, driveId, new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10)])
  const byDay = new Map(rows.map((r) => [r.day, r.n]))
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(Date.now() - (days - 1 - i) * 86400000).toISOString().slice(0, 10)
    return { day, count: byDay.get(day) || 0 }
  })
}

export const nowInterviewing = (ownerId, driveId = null) => many(
  `select c.id, c.full_name, c.role_applied, c.interview_started_at, i.name as interviewer
   from candidates c left join interviewers i on i.id = c.interviewer_id
   where c.owner_id = $1 and c.stage = 'in_interview' and ($2 is null or c.drive_id = $2)
   order by c.interview_started_at`, [ownerId, driveId])

/** Per active interviewer: how much of their assigned work is done, running, or not started. */
export const interviewerLoad = (ownerId, driveId = null) => many(
  `select i.id, i.name,
     count(c.id) filter (where c.interview_completed_at is not null) as done,
     count(c.id) filter (where c.stage = 'in_interview') as running,
     count(c.id) filter (where c.interview_completed_at is null and c.stage != 'in_interview' and c.stage not in ('no_show','rejected')) as not_started
   from interviewers i left join candidates c on c.interviewer_id = i.id and ($2 is null or c.drive_id = $2)
   where i.owner_id = $1 and i.active = 1 group by i.id order by (count(c.id)) desc, i.name`, [ownerId, driveId])

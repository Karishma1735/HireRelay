import { one, many } from '../db.js'

/**
 * Whether an interviewer can take a new candidate right now.
 *  inactive  - HR switched them off
 *  on_break  - they paused themselves
 *  left      - their "leaving at" time has passed
 *  available - otherwise
 */
export function availabilityOf(iv, now = Date.now()) {
  if (!iv.active) return { state: 'inactive', label: 'inactive' }
  if (iv.availability === 'on_break') return { state: 'on_break', label: 'on a break' }
  if (iv.available_until && Date.parse(iv.available_until) <= now) return { state: 'left', label: 'has left for the day' }
  return { state: 'available', label: 'available' }
}

/** Candidates this interviewer has had, or has now, in one drive: current assignments plus rounds they already gave feedback on. */
export const loadIn = async (interviewerId, driveId) => (await one(
  `select count(distinct c.id) as n from candidates c left join feedback f on f.candidate_id = c.id and f.interviewer_id = $1
   where c.drive_id = $2 and c.stage != 'no_show' and (c.interviewer_id = $1 or f.id is not null)`, [interviewerId, driveId])).n

/** Checks an assignment against availability and capacity. Returns null when fine, else { code, error }. HR may still override. */
export async function assignmentProblem(ownerId, interviewerId, candidate) {
  const iv = await one('select * from interviewers where id = $1 and owner_id = $2', [interviewerId, ownerId])
  if (!iv) return { code: 'not_found', error: 'Interviewer not found', status: 404 }
  const a = availabilityOf(iv)
  if (a.state !== 'available') return { code: a.state, error: `${iv.name} is ${a.label}.`, status: 409 }
  if (iv.capacity && candidate.interviewer_id !== iv.id) {
    const n = await loadIn(iv.id, candidate.drive_id)
    if (n >= iv.capacity) return { code: 'full', error: `${iv.name} already has ${n} of ${iv.capacity} candidates in this drive.`, status: 409 }
  }
  return null
}

/**
 * Who should be called next: for each interviewer who is available, under capacity and not in an interview,
 * the candidate who has waited longest (their own assigned candidates first). One candidate is suggested once.
 */
export async function suggestNext(ownerId, driveId = null) {
  const ivs = await many(
    `select i.* from interviewers i where i.owner_id = $1 and i.active = 1
       and not exists (select 1 from candidates c where c.interviewer_id = i.id and c.stage = 'in_interview') order by i.name`, [ownerId])
  const waiting = await many(
    `select c.id, c.full_name, c.queue_number, c.checked_in_at, c.drive_id, c.interviewer_id, c.round, c.role_applied, d.name as drive_name, d.rounds as drive_rounds
     from candidates c join drives d on d.id = c.drive_id
     where c.owner_id = $1 and c.stage = 'waiting' and ($2 is null or c.drive_id = $2) order by c.checked_in_at, c.queue_number`, [ownerId, driveId])
  const taken = new Set(); const out = []
  for (const iv of ivs) {
    if (availabilityOf(iv).state !== 'available') continue
    const pool = waiting.filter((c) => !taken.has(c.id) && (c.interviewer_id === iv.id || !c.interviewer_id))
    const mine = pool.find((c) => c.interviewer_id === iv.id)
    for (const c of mine ? [mine] : pool) {
      if (iv.capacity && c.interviewer_id !== iv.id && (await loadIn(iv.id, c.drive_id)) >= iv.capacity) continue
      taken.add(c.id); out.push({ candidate: c, interviewer: { id: iv.id, name: iv.name } }); break
    }
  }
  return out
}

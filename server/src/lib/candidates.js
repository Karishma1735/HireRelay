import { one, many, query } from '../db.js'
import { mapSubmission } from './mapper.js'
import { roundInfo } from './rounds.js'

/**
 * Creates a candidate from a form submission, or recognises a duplicate.
 * A duplicate (same email OR phone in the drive, or the same Google response id) may only fill
 * profile fields that are still empty. Stage, queue, interviewer and timestamps are HR-managed
 * and are never written here.
 */
export async function upsertFromSubmission({ drive, raw, source, force = false }) {
  const { columns, extra, externalRef } = mapSubmission(raw, drive.field_map)
  if (!columns.full_name) return { outcome: 'rejected', message: 'No name found in the submission' }
  if (!columns.email_norm && !columns.phone_norm) return { outcome: 'rejected', message: 'Submission needs a valid email or phone number' }

  // HR deleted the candidate made from this very response: do not bring it back (unless HR explicitly imports it).
  if (externalRef) {
    const gone = await one('select 1 from deleted_responses where drive_id = $1 and source = $2 and external_ref = $3', [drive.id, source, externalRef])
    if (gone && !force) return { outcome: 'skipped', message: 'This response was deleted earlier' }
    if (gone && force) await query('delete from deleted_responses where drive_id = $1 and source = $2 and external_ref = $3', [drive.id, source, externalRef])
  }

  const existing = await findExisting(drive.id, columns, source, externalRef)
  if (existing) return { outcome: 'duplicate', candidate: await fillBlanks(existing, columns, extra), message: 'Already registered' }

  try {
    const candidate = await one(
      `insert into candidates (owner_id, drive_id, full_name, email, phone, email_norm, phone_norm, role_applied,
         experience_years, current_company, source, external_ref, extra)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`,
      [drive.owner_id, drive.id, columns.full_name, columns.email, columns.phone, columns.email_norm, columns.phone_norm,
        columns.role_applied, columns.experience_years, columns.current_company, source, externalRef, extra]
    )
    return { outcome: 'created', candidate }
  } catch (e) {
    if (e.code !== '23505') throw e // lost a race with a concurrent identical submission
    const winner = await findExisting(drive.id, columns, source, externalRef)
    if (!winner) throw e
    return { outcome: 'duplicate', candidate: winner, message: 'Already registered' }
  }
}

async function findExisting(driveId, c, source, externalRef) {
  return one(
    `select * from candidates where drive_id = $1 and (
       ($2 is not null and email_norm = $2) or
       ($3 is not null and phone_norm = $3) or
       ($4 is not null and source = $5 and external_ref = $4)
     ) order by created_at limit 1`,
    [driveId, c.email_norm, c.phone_norm, externalRef, source]
  )
}

async function fillBlanks(existing, c, extra) {
  return one(
    `update candidates set
       email = coalesce(email, $2), email_norm = coalesce(email_norm, $3),
       phone = coalesce(phone, $4), phone_norm = coalesce(phone_norm, $5),
       role_applied = coalesce(role_applied, $6), experience_years = coalesce(experience_years, $7),
       current_company = coalesce(current_company, $8), extra = json_patch($9, extra), updated_at = now()
     where id = $1 returning *`,
    [existing.id, c.email, c.email_norm, c.phone, c.phone_norm, c.role_applied, c.experience_years, c.current_company, extra]
  ).catch(async (e) => { if (e.code === '23505') return existing; throw e })
}

export const logIngest = (ownerId, driveId, source, result, payload) =>
  query(
    `insert into ingest_events (owner_id, drive_id, source, outcome, candidate_id, message, payload) values ($1,$2,$3,$4,$5,$6,$7)`,
    [ownerId, driveId, source, result.outcome, result.candidate?.id ?? null, result.message ?? null, payload ?? null]
  )

// ---- HR-driven stage changes ----
const TRANSITIONS = {
  registered: ['checked_in', 'no_show'],
  checked_in: ['waiting', 'no_show'],
  waiting: ['in_interview', 'checked_in', 'no_show'],
  in_interview: ['completed', 'waiting'],
  completed: ['selected', 'rejected'],
  selected: ['completed'], rejected: ['completed'],
  no_show: ['registered']
}
export const STAGES = Object.keys(TRANSITIONS)

export async function changeStage(ownerId, id, stage, { interviewerId, autoQueue = false } = {}) {
  const c = await one('select * from candidates where id = $1 and owner_id = $2', [id, ownerId])
  if (!c) return { error: 'Candidate not found', status: 404 }
  if (!(TRANSITIONS[c.stage] || []).includes(stage)) return { error: `Cannot move from ${c.stage} to ${stage}`, status: 409 }
  if (interviewerId) {
    const iv = await one('select id from interviewers where id = $1 and owner_id = $2', [interviewerId, ownerId])
    if (!iv) return { error: 'Interviewer not found', status: 404 }
  }
  // Only the last round can end in a selection; earlier rounds advance the candidate instead.
  if (stage === 'selected') {
    const drive = await one('select rounds from drives where id = $1', [c.drive_id]); const r = roundInfo(drive, c.round)
    if (!r.final) return { error: `${c.full_name} is in round ${r.number} of ${r.total} (${r.name}). Advance them to ${r.next_name} first, or reject them.`, status: 409 }
  }
  // Checking in can put the candidate straight into the queue (HR setting): same result as check-in followed by Add to queue.
  const goQueue = stage === 'checked_in' && autoQueue
  const sets = ['stage = $3', 'updated_at = now()']; const params = [id, ownerId, goQueue ? 'waiting' : stage]
  const add = (sql, v) => { params.push(v); sets.push(sql.replace('?', `$${params.length}`)) }
  if (stage === 'checked_in') { sets.push('checked_in_at = coalesce(checked_in_at, now())') }
  if (stage === 'waiting' || goQueue) {
    if (c.queue_number == null) add('queue_number = (select coalesce(max(queue_number),0)+1 from candidates where drive_id = ?)', c.drive_id)
    if (c.stage === 'in_interview') { sets.push('interview_started_at = null') }
  }
  if (stage === 'in_interview') {
    const who = interviewerId || c.interviewer_id
    if (!who) return { error: 'Assign an interviewer before starting the interview', status: 409 }
    add('interviewer_id = ?', who); sets.push('interview_started_at = now()')
  }
  if (stage === 'completed' && c.stage === 'in_interview') sets.push('interview_completed_at = now()')
  if (stage === 'no_show') sets.push('queue_number = null')
  if (stage === 'registered') sets.push('checked_in_at = null', 'queue_number = null')
  const row = await one(`update candidates set ${sets.join(', ')} where id = $1 and owner_id = $2 returning *`, params)
  return { candidate: row, prev: c.stage }
}

/**
 * Moves a candidate who finished a round on to the next one. They go back into the queue (their wait starts again),
 * their interviewer is cleared so the next round can have its own, and the finished round's feedback stays on record.
 */
export async function advanceRound(ownerId, id, { interviewerId } = {}) {
  const c = await one('select * from candidates where id = $1 and owner_id = $2', [id, ownerId])
  if (!c) return { error: 'Candidate not found', status: 404 }
  const drive = await one('select * from drives where id = $1', [c.drive_id]); const r = roundInfo(drive, c.round)
  if (c.stage !== 'completed') return { error: 'Only a candidate whose interview is completed can move to the next round', status: 409 }
  if (r.final) return { error: `${r.name} is the last round. Select or reject the candidate instead`, status: 409 }
  if (!(await one('select 1 from feedback where candidate_id = $1 and round = $2', [c.id, c.round]))) return { error: `Record the ${r.name} feedback before advancing`, status: 409 }
  if (interviewerId && !(await one('select 1 from interviewers where id = $1 and owner_id = $2', [interviewerId, ownerId]))) return { error: 'Interviewer not found', status: 404 }
  const row = await one(
    `update candidates set round = round + 1, stage = 'waiting', interviewer_id = $3, interview_started_at = null, interview_completed_at = null,
       checked_in_at = now(), queue_number = coalesce(queue_number, (select coalesce(max(queue_number),0)+1 from candidates where drive_id = $4)), updated_at = now()
     where id = $1 and owner_id = $2 and stage = 'completed' and round = $5 returning *`, [c.id, ownerId, interviewerId ?? null, c.drive_id, c.round])
  if (!row) return { error: 'The candidate changed while advancing. Reload and try again', status: 409 }
  return { candidate: row, from: r, to: roundInfo(drive, row.round) }
}

/** Called as a candidate is deleted: remember which form response made them. */
export const rememberDeletion = (candidateId, ownerId) => query(
  `insert or ignore into deleted_responses (drive_id, source, external_ref)
   select drive_id, source, external_ref from candidates where id = $1 and owner_id = $2 and external_ref is not null`, [candidateId, ownerId])

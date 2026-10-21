import { one, many, query } from '../db.js'
import { mapSubmission } from './mapper.js'

/**
 * Creates a candidate from a form submission, or recognises a duplicate.
 * A duplicate (same email OR phone in the drive, or the same Google response id) may only fill
 * profile fields that are still empty. Stage, queue, interviewer and timestamps are HR-managed
 * and are never written here.
 */
export async function upsertFromSubmission({ drive, raw, source }) {
  const { columns, extra, externalRef } = mapSubmission(raw, drive.field_map)
  if (!columns.full_name) return { outcome: 'rejected', message: 'No name found in the submission' }
  if (!columns.email_norm && !columns.phone_norm) return { outcome: 'rejected', message: 'Submission needs a valid email or phone number' }

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

export async function changeStage(ownerId, id, stage, { interviewerId } = {}) {
  const c = await one('select * from candidates where id = $1 and owner_id = $2', [id, ownerId])
  if (!c) return { error: 'Candidate not found', status: 404 }
  if (!(TRANSITIONS[c.stage] || []).includes(stage)) return { error: `Cannot move from ${c.stage} to ${stage}`, status: 409 }
  if (interviewerId) {
    const iv = await one('select id from interviewers where id = $1 and owner_id = $2', [interviewerId, ownerId])
    if (!iv) return { error: 'Interviewer not found', status: 404 }
  }
  const sets = ['stage = $3', 'updated_at = now()']; const params = [id, ownerId, stage]
  const add = (sql, v) => { params.push(v); sets.push(sql.replace('?', `$${params.length}`)) }
  if (stage === 'checked_in') { sets.push('checked_in_at = coalesce(checked_in_at, now())') }
  if (stage === 'waiting') {
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
  return { candidate: row }
}

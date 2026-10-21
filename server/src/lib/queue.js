import { one } from '../db.js'
import { queueNumber, interviewerAssigned } from './emails.js'
import { requestApproval, approveAndExecute } from './approvals.js'
import { getSettings } from './settings.js'

/**
 * A candidate just entered the queue: email them their number with the real count of people ahead.
 * It is sent straight away when HR enabled auto-send for queue emails; otherwise it waits for approval.
 */
export async function notifyQueued(ownerId, candidate) {
  if (!candidate.email || candidate.queue_number == null) return null
  const drive = await one('select * from drives where id = $1 and owner_id = $2', [candidate.drive_id, ownerId])
  const { ahead } = await one(`select count(*) as ahead from candidates where drive_id = $1 and stage = 'waiting' and queue_number < $2`, [candidate.drive_id, candidate.queue_number])
  const approval = await requestApproval(ownerId, {
    email: queueNumber(candidate, drive, ahead), candidateId: candidate.id, requestedBy: 'system',
    title: `Queue number #${candidate.queue_number} to ${candidate.full_name}`
  })
  if ((await getSettings(ownerId)).auto_send_queue_emails) approveAndExecute(ownerId, approval.id).catch((e) => console.error('queue email failed', e.message))
  return approval
}

const ASSIGNABLE = new Set(['registered', 'checked_in', 'waiting']) // once the interview is under way or over, an assignment email is noise

/** The candidate learns who will interview them. Sent now or queued for approval, per HR's setting. */
export async function notifyAssigned(ownerId, candidate, interviewerId, changed) {
  if (!candidate.email || !ASSIGNABLE.has(candidate.stage)) return null
  const [drive, interviewer] = await Promise.all([
    one('select * from drives where id = $1 and owner_id = $2', [candidate.drive_id, ownerId]),
    one('select * from interviewers where id = $1 and owner_id = $2', [interviewerId, ownerId])])
  if (!drive || !interviewer) return null
  const approval = await requestApproval(ownerId, {
    email: interviewerAssigned(candidate, drive, interviewer, changed), candidateId: candidate.id, requestedBy: 'system',
    title: `${changed ? 'New interviewer' : 'Interviewer'} ${interviewer.name} to ${candidate.full_name}`
  })
  if ((await getSettings(ownerId)).auto_send_assignment_emails) approveAndExecute(ownerId, approval.id).catch((e) => console.error('assignment email failed', e.message))
  return approval
}

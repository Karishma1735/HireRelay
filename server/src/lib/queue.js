import { one } from '../db.js'
import { queueNumber, interviewerAssigned, interviewerBriefing } from './emails.js'
import { cvOf } from './files.js'
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

/**
 * An interviewer was assigned (or changed). Two emails may follow, each on its own switch:
 *  - the candidate learns who will interview them;
 *  - the interviewer gets a briefing with the candidate's details and CV attached.
 */
export async function notifyAssigned(ownerId, candidate, interviewerId, changed) {
  if (!ASSIGNABLE.has(candidate.stage)) return null
  const [drive, interviewer, settings] = await Promise.all([
    one('select * from drives where id = $1 and owner_id = $2', [candidate.drive_id, ownerId]),
    one('select * from interviewers where id = $1 and owner_id = $2', [interviewerId, ownerId]), getSettings(ownerId)])
  if (!drive || !interviewer) return null
  const send = async (email, title, auto) => {
    const approval = await requestApproval(ownerId, { email, candidateId: candidate.id, requestedBy: 'system', title })
    if (auto) approveAndExecute(ownerId, approval.id).catch((e) => console.error('assignment email failed', e.message))
    return approval
  }
  let toCandidate = null
  if (candidate.email) toCandidate = await send(interviewerAssigned(candidate, drive, interviewer, changed), `${changed ? 'New interviewer' : 'Interviewer'} ${interviewer.name} to ${candidate.full_name}`, settings.auto_send_assignment_emails)
  if (interviewer.email) {
    const cv = await cvOf(candidate.id, ownerId)
    await send(interviewerBriefing(candidate, drive, interviewer, { cv }), `Briefing for ${interviewer.name}: ${candidate.full_name}${cv ? ' (CV attached)' : ''}`, settings.auto_send_interviewer_briefing)
  }
  return toCandidate
}

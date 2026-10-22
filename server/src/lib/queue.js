import { one, many } from '../db.js'
import { queueNumber, interviewerAssigned, interviewerBriefing, feedbackAlert } from './emails.js'
import { config, isPublicUrl } from '../config.js'
import { cvOf } from './files.js'
import { requestApproval, approveAndExecute } from './approvals.js'
import { getSettings } from './settings.js'
import { roundInfo } from './rounds.js'

/**
 * A candidate just entered the queue: email them their number with the real count of people ahead.
 * It is sent straight away when HR enabled auto-send for queue emails; otherwise it waits for approval.
 */
export async function notifyQueued(ownerId, candidate) {
  if (!candidate.email || candidate.queue_number == null) return null
  const drive = await one('select * from drives where id = $1 and owner_id = $2', [candidate.drive_id, ownerId])
  const { ahead } = await one(`select count(*) as ahead from candidates where drive_id = $1 and stage = 'waiting' and queue_number < $2`, [candidate.drive_id, candidate.queue_number])
  const approval = await requestApproval(ownerId, {
    email: queueNumber(candidate, drive, ahead, roundInfo(drive, candidate.round)), candidateId: candidate.id, requestedBy: 'system',
    title: `Queue number #${candidate.queue_number} to ${candidate.full_name}${roundInfo(drive, candidate.round).number > 1 ? ` (${roundInfo(drive, candidate.round).name} round)` : ''}`
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
  const round = roundInfo(drive, candidate.round)
  const send = async (email, title, auto) => {
    const approval = await requestApproval(ownerId, { email, candidateId: candidate.id, requestedBy: 'system', title })
    if (auto) approveAndExecute(ownerId, approval.id).catch((e) => console.error('assignment email failed', e.message))
    return approval
  }
  let toCandidate = null
  if (candidate.email) toCandidate = await send(interviewerAssigned(candidate, drive, interviewer, changed, round), `${changed ? 'New interviewer' : 'Interviewer'} ${interviewer.name} to ${candidate.full_name}`, settings.auto_send_assignment_emails)
  if (interviewer.email) {
    const cv = await cvOf(candidate.id, ownerId)
    const previous = (await many(
      `select f.round, f.rating, f.recommendation, f.notes, i.name as interviewer from feedback f left join interviewers i on i.id = f.interviewer_id
       where f.candidate_id = $1 and f.round < $2 order by f.round`, [candidate.id, candidate.round])).map((p) => ({ ...p, round_name: roundInfo(drive, p.round).name }))
    await send(interviewerBriefing(candidate, drive, interviewer, { cv, round, previous }), `Briefing for ${interviewer.name}: ${candidate.full_name}${cv ? ' (CV attached)' : ''}`, settings.auto_send_interviewer_briefing)
  }
  return toCandidate
}

/**
 * Feedback was recorded: email HR the interviewer's verdict. It goes to the address HR chose in settings, or to the
 * account's own address. It is sent straight away (an alert to HR needs no approval) and logged like every other send.
 * Returns what happened, so the screen can say so.
 */
export async function notifyFeedback(ownerId, candidate, feedback) {
  const settings = await getSettings(ownerId)
  if (!settings.email_feedback_alerts) return { sent: false, reason: 'off' }
  const to = settings.notify_email || (await one('select email from users where id = $1', [ownerId]))?.email
  if (!to) return { sent: false, reason: 'no address' }
  const [drive, interviewer] = await Promise.all([
    one('select * from drives where id = $1 and owner_id = $2', [candidate.drive_id, ownerId]),
    feedback.interviewer_id ? one('select * from interviewers where id = $1 and owner_id = $2', [feedback.interviewer_id, ownerId]) : null])
  const minutes = candidate.interview_started_at && candidate.interview_completed_at ? Math.max(0, Math.round((Date.parse(candidate.interview_completed_at) - Date.parse(candidate.interview_started_at)) / 60000)) : null
  const email = feedbackAlert(candidate, drive, interviewer, feedback, { toEmail: to, appUrl: isPublicUrl(config.publicUrl) ? config.publicUrl : null, minutes, round: roundInfo(drive, feedback.round) })
  const approval = await requestApproval(ownerId, { email, candidateId: candidate.id, requestedBy: 'system', title: `Feedback alert: ${candidate.full_name} (${feedback.recommendation})${roundInfo(drive, feedback.round).multi ? ` · ${roundInfo(drive, feedback.round).name}` : ''}` })
  approveAndExecute(ownerId, approval.id).catch((e) => console.error('feedback alert failed', e.message))
  return { sent: true, to }
}

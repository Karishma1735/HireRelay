const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const when = (d) => (d ? new Date(d).toISOString().slice(0, 10) : 'the scheduled date')
const wrap = (lines) => lines.map((l) => `<p>${l}</p>`).join('')

export function registrationConfirmation(c, drive) {
  return {
    purpose: 'registration_confirmation', to: c.email,
    subject: `You're registered: ${drive.name}`,
    body: wrap([
      `Hi ${esc(c.full_name)},`,
      `Thanks for registering for <b>${esc(drive.name)}</b>${drive.role_title ? ` (${esc(drive.role_title)})` : ''}.`,
      `Please arrive at ${esc(drive.venue || 'the venue')} on ${esc(when(drive.drive_date))} and check in at the desk.`,
      'Regards,<br>The hiring team'])
  }
}
export function interviewReminder(c, drive) {
  return {
    purpose: 'interview_reminder', to: c.email,
    subject: `Interview reminder: ${drive.name}`,
    body: wrap([
      `Hi ${esc(c.full_name)},`,
      `A reminder about your interview at <b>${esc(drive.name)}</b>${c.queue_number ? ` — your queue number is <b>${c.queue_number}</b>` : ''}.`,
      `Please be at ${esc(drive.venue || 'the venue')} and keep your queue number handy.`,
      'Regards,<br>The hiring team'])
  }
}
export function feedbackReminder(interviewer, items) {
  return {
    purpose: 'feedback_reminder', to: interviewer.email,
    subject: `Pending interview feedback (${items.length})`,
    body: wrap([
      `Hi ${esc(interviewer.name)},`,
      'Feedback is still pending for these completed interviews:',
      `<ul>${items.map((i) => `<li>${esc(i.full_name)}${i.role_applied ? ` — ${esc(i.role_applied)}` : ''}</li>`).join('')}</ul>`,
      'Please submit it in HireRelay today.',
      'Thank you,<br>The hiring team'])
  }
}

export function queueNumber(c, drive, ahead) {
  return {
    // The approvals table's purpose list is fixed at creation; queue notices use 'custom'.
    purpose: 'custom', to: c.email,
    subject: `You're checked in: queue number ${c.queue_number}`,
    body: wrap([
      `Hi ${esc(c.full_name)},`,
      `You're checked in for <b>${esc(drive.name)}</b>. Your queue number is <b style="font-size:1.4em">#${c.queue_number}</b>.`,
      ahead > 0 ? `There ${ahead === 1 ? 'is' : 'are'} ${ahead} ${ahead === 1 ? 'person' : 'people'} ahead of you right now.` : 'You are first in line.',
      `Please stay near ${esc(drive.venue || 'the interview area')} and keep this number handy. We'll call you when it's your turn.`,
      'Regards,<br>The hiring team'])
  }
}

export function interviewerAssigned(c, drive, interviewer, changed) {
  return {
    purpose: 'custom', to: c.email,
    subject: changed ? `Your interviewer has changed: ${interviewer.name}` : `Your interviewer: ${interviewer.name}`,
    body: wrap([
      `Hi ${esc(c.full_name)},`,
      changed ? `Your interviewer for <b>${esc(drive.name)}</b> has changed. You will now be interviewed by <b>${esc(interviewer.name)}</b>.`
        : `You have been assigned to <b>${esc(interviewer.name)}</b> for your interview at <b>${esc(drive.name)}</b>.`,
      c.queue_number ? `Your queue number is <b>#${c.queue_number}</b>.` : 'You will receive your queue number when you check in.',
      `Please stay near ${esc(drive.venue || 'the interview area')}. We will call you when it is your turn.`,
      'Regards,<br>The hiring team'])
  }
}

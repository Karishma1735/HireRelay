const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const when = (d) => (d ? new Date(d).toISOString().slice(0, 10) : 'the scheduled date')
const roundLine = (r) => (r?.multi ? `Round ${r.number} of ${r.total}: <b>${esc(r.name)}</b>` : '')
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

export function queueNumber(c, drive, ahead, round) {
  return {
    // The approvals table's purpose list is fixed at creation; queue notices use 'custom'.
    purpose: 'custom', to: c.email,
    subject: round?.multi && round.number > 1 ? `Next round: ${round.name}, queue number ${c.queue_number}` : `You're checked in: queue number ${c.queue_number}`,
    body: wrap([
      `Hi ${esc(c.full_name)},`,
      round?.multi && round.number > 1 ? `Congratulations, you are through to the next round of <b>${esc(drive.name)}</b>.` : `You're checked in for <b>${esc(drive.name)}</b>.`,
      round?.multi ? `${roundLine(round)}.` : '',
      `Your queue number is <b style="font-size:1.4em">#${c.queue_number}</b>.`,
      ahead > 0 ? `There ${ahead === 1 ? 'is' : 'are'} ${ahead} ${ahead === 1 ? 'person' : 'people'} ahead of you right now.` : 'You are first in line.',
      `Please stay near ${esc(drive.venue || 'the interview area')} and keep this number handy. We'll call you when it's your turn.`,
      'Regards,<br>The hiring team'].filter(Boolean))
  }
}

export function interviewerAssigned(c, drive, interviewer, changed, round) {
  return {
    purpose: 'custom', to: c.email,
    subject: changed ? `Your interviewer has changed: ${interviewer.name}` : `Your interviewer: ${interviewer.name}`,
    body: wrap([
      `Hi ${esc(c.full_name)},`,
      changed ? `Your interviewer for <b>${esc(drive.name)}</b> has changed. You will now be interviewed by <b>${esc(interviewer.name)}</b>.`
        : `You have been assigned to <b>${esc(interviewer.name)}</b> for your interview at <b>${esc(drive.name)}</b>.`,
      round?.multi ? `${roundLine(round)}.` : '',
      c.queue_number ? `Your queue number is <b>#${c.queue_number}</b>.` : 'You will receive your queue number when you check in.',
      `Please stay near ${esc(drive.venue || 'the interview area')}. We will call you when it is your turn.`,
      'Regards,<br>The hiring team'].filter(Boolean))
  }
}

const ROW_SKIP = new Set(['responseid', 'createtime', 'lastsubmittedtime'])
const cell = (v, max = 300) => esc(String(v ?? '').slice(0, max))

/** Everything an interviewer needs before meeting a candidate. All text is escaped: form answers come from the public. */
export function interviewerBriefing(c, drive, interviewer, { cv, round, previous = [] } = {}) {
  const facts = [
    ['Role applied for', c.role_applied], ['Experience', c.experience_years != null ? `${c.experience_years} years` : null], ['Current company', c.current_company],
    ['Interview round', round?.multi ? `${round.number} of ${round.total}: ${round.name}` : null], ['Email', c.email], ['Phone', c.phone], ['Drive', drive.name], ['Venue', drive.venue], ['Queue number', c.queue_number ? `#${c.queue_number}` : null]
  ].filter(([, v]) => v)
  const answers = Object.entries(c.extra || {}).filter(([k, v]) => v && !ROW_SKIP.has(k.toLowerCase())).slice(0, 25)
  const table = (rows) => `<table cellpadding="6" style="border-collapse:collapse;font-size:14px">${rows.map(([k, v]) => `<tr><td style="color:#57534e;vertical-align:top;border-bottom:1px solid #e7e5e4"><b>${esc(String(k).replace(/_/g, ' '))}</b></td><td style="border-bottom:1px solid #e7e5e4">${cell(v)}</td></tr>`).join('')}</table>`
  return {
    purpose: 'custom', to: interviewer.email,
    subject: `New candidate for you: ${c.full_name}${c.role_applied ? ` (${c.role_applied})` : ''}`,
    attachments: cv ? [{ file_id: cv.id, name: cv.original_name }] : [],
    body: wrap([
      `Hi ${esc(interviewer.name)},`,
      `<b>${esc(c.full_name)}</b> has been assigned to you for <b>${esc(drive.name)}</b>. Here is what we know:`,
      table(facts),
      answers.length ? `<b>Their answers on the registration form</b>${table(answers)}` : '',
      previous.length ? `<b>What earlier rounds said</b>${table(previous.map((p) => [`${p.round_name} (${p.interviewer || 'interviewer'}): ${p.recommendation}, ${p.rating}/5`, p.notes || 'no notes']))}` : '',
      cv ? `Their CV is attached: <b>${esc(cv.original_name)}</b>.` : 'They did not upload a CV.',
      'Regards,<br>The hiring team'].filter(Boolean))
  }
}

const VERDICT = {
  hire: { label: 'Selected', phrase: 'recommends selecting', color: '#15803d' },
  hold: { label: 'On hold', phrase: 'wants to put on hold', color: '#b45309' },
  reject: { label: 'Rejected', phrase: 'recommends rejecting', color: '#b91c1c' }
}
const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n)

/** Tells HR what an interviewer decided, with enough about the candidate to act without opening the app. */
export function feedbackAlert(c, drive, interviewer, fb, { toEmail, appUrl, minutes, round } = {}) {
  const v = VERDICT[fb.recommendation]
  const who = interviewer?.name || 'the interviewer'
  const rows = [
    ['Candidate', c.full_name], ['Role applied for', c.role_applied], ['Drive', drive.name], ['Round', round?.multi ? `${round.number} of ${round.total}: ${round.name}` : null], ['Interviewer', interviewer?.name || 'not recorded'],
    ['Rating', `${fb.rating}/5  ${stars(fb.rating)}`], ['Email', c.email], ['Phone', c.phone],
    ['Experience', c.experience_years != null ? `${c.experience_years} years` : null], ['Current company', c.current_company],
    ['Interview length', minutes != null ? `${minutes} min` : null]
  ].filter(([, val]) => val)
  return {
    purpose: 'custom', to: toEmail,
    subject: `${v.label}: ${c.full_name}${c.role_applied ? ` (${c.role_applied})` : ''}, ${round?.multi ? `${round.name} round feedback` : 'feedback'} from ${who}`,
    body: wrap([
      `<span style="font-size:18px;font-weight:bold;color:${v.color}">${esc(v.label)}</span> — ${esc(who)} ${v.phrase} <b>${esc(c.full_name)}</b>.`,
      `<table cellpadding="6" style="border-collapse:collapse;font-size:14px">${rows.map(([k, val]) => `<tr><td style="color:#57534e;border-bottom:1px solid #e7e5e4"><b>${esc(k)}</b></td><td style="border-bottom:1px solid #e7e5e4">${esc(String(val).slice(0, 300))}</td></tr>`).join('')}</table>`,
      fb.notes ? `<b>Interviewer's notes</b><br>${esc(fb.notes).replace(/\n/g, '<br>')}` : '<i>No notes were added.</i>',
      appUrl ? `Decide next steps in HireRelay: <a href="${esc(appUrl)}/candidates">open Candidates</a>.` : 'Open HireRelay to mark the candidate Selected or Rejected.',
      'This alert was sent automatically by HireRelay.'])
  }
}

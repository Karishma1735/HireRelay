import { one, query } from '../db.js'

// Every on/off switch HR has, with its default for anyone who never changed it.
export const BOOLEAN_SETTINGS = {
  auto_send_confirmations: false,
  auto_queue_on_check_in: true,
  auto_send_queue_emails: true,
  auto_send_assignment_emails: true,
  auto_send_interviewer_briefing: true,
  email_feedback_alerts: true
}
export const SETTING_DEFAULTS = { ...BOOLEAN_SETTINGS, notify_email: null } // notify_email: where feedback alerts go (blank = the account's own address)
const COLUMNS = Object.keys(SETTING_DEFAULTS)

export async function getSettings(ownerId) {
  return { ...SETTING_DEFAULTS, ...((await one(`select ${COLUMNS.join(', ')} from settings where owner_id = $1`, [ownerId])) || {}) }
}

/** Merges a partial update over the current values and stores all of them. */
export async function saveSettings(ownerId, patch) {
  const cur = { ...(await getSettings(ownerId)), ...patch }
  await query(
    `insert into settings (owner_id, ${COLUMNS.join(', ')}) values ($1, ${COLUMNS.map((_, i) => `$${i + 2}`).join(', ')})
     on conflict (owner_id) do update set ${COLUMNS.map((c, i) => `${c} = $${i + 2}`).join(', ')}`,
    [ownerId, ...COLUMNS.map((c) => cur[c])])
  return cur
}

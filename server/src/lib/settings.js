import { one } from '../db.js'

export const SETTING_DEFAULTS = { auto_send_confirmations: false, auto_queue_on_check_in: true, auto_send_queue_emails: true }

/** HR's switches, with defaults for anyone who has not changed them yet. */
export async function getSettings(ownerId) {
  return { ...SETTING_DEFAULTS, ...((await one('select auto_send_confirmations, auto_queue_on_check_in, auto_send_queue_emails from settings where owner_id = $1', [ownerId])) || {}) }
}

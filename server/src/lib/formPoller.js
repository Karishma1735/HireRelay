import { one, many } from '../db.js'
import { config } from '../config.js'
import * as vs from './viasocket.js'
import { upsertFromSubmission, logIngest } from './candidates.js'
import { afterCandidateCreated } from '../routes/public.js'

// viaSocket's own Google Forms trigger can be slow to fire. Checking the form's latest response ourselves every
// few seconds makes new registrations appear promptly; the shared response id / email / phone checks keep both
// paths from ever creating the same candidate twice.
const STAND_INS = new Set(['sampleId', 'r_123'])
const lastSeen = new Map() // subscription id -> last response id handled, so unchanged responses cost nothing

/** False for viaSocket's stand-in samples (what it shows when a form has no real response yet). */
export function isRealResponse(event) {
  if (!event || typeof event !== 'object' || !event.responseId || STAND_INS.has(event.responseId)) return false
  return !('Domain_to_be_enabled' in event) // the connector's documentation sample
}

/** A real response that arrived after syncing started. Anything else (a stand-in sample, an older response) is ignored. */
export function isNewRealResponse(event, subscribedAt) {
  if (!isRealResponse(event)) return false
  const at = Date.parse(event.createTime || event.lastSubmittedTime || '')
  return Number.isFinite(at) && at >= Date.parse(subscribedAt) - 60_000
}

export async function pollOnce() {
  const subs = await many(
    `select s.id, s.owner_id, s.auth_id, s.input_data, s.created_at as subscribed_at, d.id as drive_id
     from viasocket_subscriptions s join drives d on d.id = s.drive_id where s.status = 'active' and d.status = 'active'`)
  let added = 0
  for (const s of subs) {
    try {
      const { viasocket_help, ...event } = (await vs.sampleTriggerEvent(config.viasocket.forms.triggerId, s.auth_id, config.viasocket.forms.authType, s.input_data)) || {}
      if (!isNewRealResponse(event, s.subscribed_at) || lastSeen.get(s.id) === event.responseId) continue
      lastSeen.set(s.id, event.responseId)
      const drive = await one('select * from drives where id = $1', [s.drive_id])
      const result = await upsertFromSubmission({ drive, raw: event, source: 'google_forms' })
      if (result.outcome === 'created') { await logIngest(s.owner_id, drive.id, 'google_forms', result, event); await afterCandidateCreated(drive, result.candidate); added++ }
      else if (result.outcome === 'rejected') await logIngest(s.owner_id, drive.id, 'google_forms', result, event) // so a bad form is visible
    } catch (e) { console.error(`form poll failed for ${s.id}:`, e.message) }
  }
  return added
}

export function startFormPoller() {
  const seconds = Number(process.env.FORM_POLL_SECONDS ?? 30)
  if (!(seconds > 0) || !vs.isConfigured()) return null
  let running = false
  const timer = setInterval(async () => { if (running) return; running = true; try { await pollOnce() } finally { running = false } }, seconds * 1000)
  timer.unref()
  return timer
}

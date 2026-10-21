import jwt from 'jsonwebtoken'
import { config } from '../config.js'

export class ViaSocketError extends Error {
  constructor(message, { status = 502, code = 'viasocket_error', detail } = {}) {
    super(message); this.status = status; this.code = code; this.detail = detail
  }
}

export const isConfigured = () => !!(config.viasocket.orgId && config.viasocket.projectId && config.viasocket.secret && config.viasocket.apiUrl && config.viasocket.runUrl)

export function missingConfig() {
  return [
    ['VIASOCKET_ORG_ID', config.viasocket.orgId],
    ['VIASOCKET_PROJECT_ID', config.viasocket.projectId],
    ['VIASOCKET_API_URL', config.viasocket.apiUrl],
    ['VIASOCKET_RUN_URL', config.viasocket.runUrl],
    ['VIASOCKET_EMBED_SECRET', config.viasocket.secret]
  ].filter(([, v]) => !v).map(([k]) => k)
}

function requireConfigured() {
  if (!isConfigured()) {
    throw new ViaSocketError(
      `viaSocket is not configured. Missing: ${missingConfig().join(', ')}. Open viaSocket → Integrations → the embed → Install Code, copy the values into .env and restart.`,
      { status: 503, code: 'viasocket_not_configured' }
    )
  }
}

/** HS256, three claims, no exp (valid until the secret rotates). One stable id per HR user: their Supabase user id. */
export function embedToken(uniqueIdentifier) {
  requireConfigured()
  return jwt.sign(
    { org_id: config.viasocket.orgId, project_id: config.viasocket.projectId, unique_identifier: String(uniqueIdentifier) },
    config.viasocket.secret,
    { algorithm: 'HS256', noTimestamp: true }
  )
}

async function call(path, uid, { body, method = 'POST' } = {}) {
  const res = await fetch(`${config.viasocket.apiUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', authorization: embedToken(uid) },
    body: method === 'GET' || body === undefined ? undefined : JSON.stringify(body)
  })
  const payload = await res.json().catch(() => ({}))
  if (res.status === 401) throw new ViaSocketError('viaSocket rejected the embed token: check VIASOCKET_EMBED_SECRET, org id and project id.', { status: 502, code: 'viasocket_unauthorized' })
  if (!res.ok || payload.success === false) throw new ViaSocketError(payload.message || `viaSocket ${path} failed (${res.status})`, { detail: payload })
  return payload.data
}

export const listConnections = (uid) => call('/embed/authentications', uid, { method: 'GET' })
export const revokeConnection = (uid, authId) => call(`/embed/authentications/revoke/${authId}`, uid, { method: 'DELETE' })
export const setFlowStatus = (uid, scriptId, status) => call(`/embed/updatestatus/${scriptId}?status=${status}`, uid, { method: 'PUT' })

export async function findEnabledApp(uid, serviceId) {
  const data = await call(`/projects/${config.viasocket.projectId}/integrations`, uid, { method: 'GET' })
  return (data?.flows || []).find((f) => f.service_id === serviceId && f.status === 'active')?.id || null
}
export async function enableApp(uid, serviceId, authId) {
  const existing = await findEnabledApp(uid, serviceId)
  if (existing) return existing
  const data = await call(`/embed/enable/${serviceId}/${authId}`, uid, { body: undefined })
  return data.script_id
}

/** Options for a picker field. Surfaces the 200-with-nested-400 failure shape instead of returning an empty list. */
export async function listOptions(uid, actionVersionId, fieldKey, authId, existingFields = {}) {
  const data = await call(`/embed/list-options/${actionVersionId}`, uid, { body: { fieldKey, auth_id: authId, existingFields } })
  if (data && !Array.isArray(data) && data.response && Number(data.response.status) >= 400) {
    throw new ViaSocketError(data.response.data?.message || 'list-options failed', { status: 502, code: 'viasocket_connection_unreadable' })
  }
  return Array.isArray(data) ? data : (data?.data || [])
}

/** Runs an app action as the user, on their script_id (the credential). Returns the real response. */
export async function runAction(scriptId, actionVersionId, inputData) {
  const res = await fetch(`${config.viasocket.runUrl}/func/${scriptId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action_version_id: actionVersionId, inputData })
  })
  const payload = await res.json().catch(() => ({}))
  const isEnvelope = payload && typeof payload === 'object' && typeof payload.success === 'boolean' && 'data' in payload
  const failed = isEnvelope ? !payload.success : payload?.success === false
  if (failed || !res.ok || payload?.response?.status >= 400) {
    throw new ViaSocketError(payload.message || payload.error?.message || payload?.response?.data?.message || `Action failed (${res.status})`, { detail: payload })
  }
  return isEnvelope ? payload.data : payload
}

export async function subscribeEvent(uid, triggerVersionId, authId, inputData, code, meta = {}) {
  const data = await call(`/embed/subscribe-event/${triggerVersionId}`, uid, { body: { auth_id: authId, inputData, code, meta } })
  return data.script_id
}

/** One real event for a connection: exactly what a handler reads at context.req.body. */
export async function sampleTriggerEvent(triggerId, authId, authType, inputData) {
  const url = `${config.viasocket.runUrl}/func/scrijZpnr8zJ?action_id=${encodeURIComponent(triggerId)}&auth_id=${encodeURIComponent(authId)}&authType=${encodeURIComponent(authType)}`
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context: { inputData } }), signal: AbortSignal.timeout(20000) })
  return res.json().catch(() => ({}))
}

/** AI in the product: the backend asks, viaSocket runs the model. No model key in HireRelay. */
export async function askAI(uid, body) {
  return call('/embed/ai/message', uid, { body })
}
export const aiHistory = (uid, threadId) => call(`/embed/ai/threads/${encodeURIComponent(threadId)}/history?page=1`, uid, { method: 'GET' })

/** The handler string viaSocket runs per Google Forms event (Template B: tell our own backend). */
export function formsHandler({ ingestUrl, driveId, ingestKey }) {
  return `
  const event = Object.assign({}, context.req.body)
  delete event.viasocket_help
  const response = await axios.post(${JSON.stringify(ingestUrl)}, { drive_id: ${JSON.stringify(driveId)}, event }, {
    headers: { 'x-hirerelay-ingest-key': ${JSON.stringify(ingestKey)} },
    validateStatus: () => true
  })
  if (response.status >= 400) throw new Error('HireRelay rejected the submission: ' + response.status + ' ' + JSON.stringify(response.data))
  return response.data
`
}

/** The run history viaSocket keeps (30 days) for one flow, e.g. a Google Forms subscription: did it fire, did the handler fail. */
export async function flowRuns(uid, scriptId, limit = 10) {
  const reg = await call('/users/register', uid, { method: 'GET' })
  const token = reg?.token
  if (!token) throw new ViaSocketError('viaSocket did not issue a history token', { status: 502 })
  const res = await fetch(`${config.viasocket.apiUrl}/logs/orgId/${config.viasocket.orgId}?projectId=${config.viasocket.projectId}&scriptId=${encodeURIComponent(scriptId)}&page=1&limit=${limit}`, { headers: { proxy_auth_token: token } })
  const payload = await res.json().catch(() => ({}))
  if (!res.ok || payload.success === false) throw new ViaSocketError(payload.message || `run history failed (${res.status})`, { detail: payload })
  return payload.data?.finalResponse || []
}

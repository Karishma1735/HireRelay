import { Router } from 'express'
import { z } from 'zod'
import { config, isPublicUrl } from '../config.js'
import { one, many, query } from '../db.js'
import * as vs from '../lib/viasocket.js'
import { ingestKeyFor } from '../lib/ingestKey.js'
import { mapSubmission } from '../lib/mapper.js'
import { upsertFromSubmission, logIngest } from '../lib/candidates.js'
import { afterCandidateCreated } from './public.js'
import { isRealResponse } from '../lib/formPoller.js'

const { forms, gmail } = config.viasocket
const APPS = {
  [forms.serviceId]: { key: 'google_forms', name: 'Google Forms', icon: 'https://stuff.thingsofbrand.com/google.com/images/imgb_Google_Forms_Logo.png', needsEnable: false },
  [gmail.serviceId]: { key: 'gmail', name: 'Gmail', icon: 'https://stuff.thingsofbrand.com/gmail.com/images/imge_idrA5FDGTH_1763454052978.svg', needsEnable: true }
}
const uuid = z.string().uuid()

export function viasocketRoutes() {
  const r = Router()
  const uid = (req) => req.user.id
  const connectionOf = (req, serviceId) => one('select * from viasocket_connections where owner_id = $1 and service_id = $2', [uid(req), serviceId])

  /** Setup state + the connections HireRelay holds for this user, cross-checked with viaSocket when it is configured. */
  r.get('/status', async (req, res) => {
    const configured = vs.isConfigured()
    const local = await many('select service_id, auth_id, script_id is not null as enabled, config from viasocket_connections where owner_id = $1', [uid(req)])
    let live = null; let liveError = null
    if (configured) { try { live = await vs.listConnections(uid(req)) } catch (e) { liveError = e.message } }
    const liveList = Array.isArray(live) ? live : (live?.authentications || [])
    const apps = Object.entries(APPS).map(([serviceId, app]) => {
      const row = local.find((l) => l.service_id === serviceId)
      const l = row && liveList.find((a) => a.id === row.auth_id)
      return {
        service_id: serviceId, name: app.name, icon: app.icon,
        connected: !!row && (live === null || !!l), expired: !!l?.isExpired, auth_id: row?.auth_id ?? null,
        enabled: !!row?.enabled, config: row ? { from: row.config?.from ?? null } : {}
      }
    })
    res.json({
      configured, missing: vs.missingConfig(), org_id: config.viasocket.orgId, project_id: config.viasocket.projectId,
      public_url_ok: isPublicUrl(config.publicUrl), ingest_secret_ok: !!config.ingestSecret, live_error: liveError, apps,
      action_ids: { gmail_send: gmail.sendActionId, forms_trigger: forms.triggerId }
    })
  })

  // The browser only ever receives a token, to open the Connect popup or mount the prebuilt UI.
  r.get('/token', (req, res) => res.json({ token: vs.embedToken(uid(req)) }))

  r.post('/connected', async (req, res) => {
    const b = z.object({ serviceId: z.string(), authId: z.string().min(3).max(200) }).parse(req.body)
    if (!APPS[b.serviceId]) return res.status(400).json({ error: 'Unsupported app' })
    // Never trust the browser: the connection must exist for this user on viaSocket.
    const live = await vs.listConnections(uid(req))
    const list = Array.isArray(live) ? live : (live?.authentications || [])
    if (!list.some((a) => a.id === b.authId && a.id.endsWith(`_${b.serviceId}`))) return res.status(400).json({ error: 'viaSocket does not list that connection for your account' })
    const scriptId = APPS[b.serviceId].needsEnable ? await vs.enableApp(uid(req), b.serviceId, b.authId) : null
    const prev = await connectionOf(req, b.serviceId)
    const keep = prev && prev.auth_id === b.authId
    await query(
      `insert into viasocket_connections (owner_id, service_id, auth_id, script_id, config) values ($1,$2,$3,$4,$5)
       on conflict (owner_id, service_id) do update set auth_id = $3, script_id = $4, config = $5`,
      [uid(req), b.serviceId, b.authId, scriptId, keep ? prev.config : {}])
    res.json({ ok: true })
  })

  r.delete('/connections/:serviceId', async (req, res) => {
    const conn = await connectionOf(req, req.params.serviceId)
    if (!conn) return res.status(404).json({ error: 'Not connected' })
    // Pause what is built on the connection first, then disconnect.
    const subs = await many(`select id, script_id from viasocket_subscriptions where owner_id = $1 and auth_id = $2 and status = 'active'`, [uid(req), conn.auth_id])
    for (const s of subs) { await vs.setFlowStatus(uid(req), s.script_id, 0); await query(`update viasocket_subscriptions set status = 'removed' where id = $1`, [s.id]) }
    if (conn.script_id) await vs.setFlowStatus(uid(req), conn.script_id, 0)
    await vs.revokeConnection(uid(req), conn.auth_id)
    await query('delete from viasocket_connections where id = $1', [conn.id])
    res.json({ ok: true })
  })

  // ---- Gmail: the sender address is the user's own choice, picked from their account ----
  r.get('/gmail/senders', async (req, res) => {
    const conn = await connectionOf(req, gmail.serviceId)
    if (!conn) return res.status(409).json({ error: 'Connect Gmail first' })
    res.json(await vs.listOptions(uid(req), gmail.sendActionVersionId, 'from', conn.auth_id))
  })
  r.put('/gmail/sender', async (req, res) => {
    const { from } = z.object({ from: z.string().min(1) }).parse(req.body)
    const conn = await connectionOf(req, gmail.serviceId)
    if (!conn) return res.status(409).json({ error: 'Connect Gmail first' })
    const options = await vs.listOptions(uid(req), gmail.sendActionVersionId, 'from', conn.auth_id)
    if (!options.some((o) => o.value === from)) return res.status(400).json({ error: 'That sender is not one of your Gmail addresses' })
    await query(`update viasocket_connections set config = json_patch(config, $3) where id = $1 and owner_id = $2`, [conn.id, uid(req), { from }])
    res.json({ ok: true })
  })

  // ---- Google Forms ----
  r.get('/forms', async (req, res) => {
    const conn = await connectionOf(req, forms.serviceId)
    if (!conn) return res.status(409).json({ error: 'Connect Google Forms first' })
    res.json(await vs.listOptions(uid(req), forms.pickerActionVersionId, 'id', conn.auth_id))
  })

  const driveOf = async (req) => {
    const d = await one('select * from drives where id = $1 and owner_id = $2', [uuid.parse(req.params.driveId), uid(req)])
    if (!d) throw Object.assign(new Error('Drive not found'), { status: 404 })
    return d
  }

  r.post('/drives/:driveId/google-form', async (req, res) => {
    const drive = await driveOf(req)
    const { form_id: formId } = z.object({ form_id: z.string().min(3) }).parse(req.body)
    const conn = await connectionOf(req, forms.serviceId)
    if (!conn) return res.status(409).json({ error: 'Connect Google Forms first' })
    if (!isPublicUrl(config.publicUrl)) return res.status(409).json({ error: 'Set HIRERELAY_PUBLIC_URL to a URL viaSocket can reach (a tunnel in development, your domain in production): the handler posts each response to it.', code: 'public_url_missing' })
    if (!config.ingestSecret) return res.status(409).json({ error: 'Set INGEST_SECRET in .env first.', code: 'ingest_secret_missing' })
    if (await one(`select 1 from viasocket_subscriptions where drive_id = $1 and status = 'active'`, [drive.id])) return res.status(409).json({ error: 'This drive already has a Google Form connected. Disconnect it first.' })
    const options = await vs.listOptions(uid(req), forms.pickerActionVersionId, 'id', conn.auth_id)
    if (!options.some((o) => o.value === formId)) return res.status(400).json({ error: 'That form is not in your Google account' })
    const handler = vs.formsHandler({ ingestUrl: `${config.publicUrl}/api/ingest/google-forms`, driveId: drive.id, ingestKey: ingestKeyFor(drive.id) })
    const inputData = { id: formId }
    const scriptId = await vs.subscribeEvent(uid(req), forms.triggerVersionId, conn.auth_id, inputData, handler, { user_id: uid(req), drive_id: drive.id })
    const sub = await one(
      `insert into viasocket_subscriptions (owner_id, drive_id, service_id, trigger_version_id, script_id, auth_id, input_data, handler)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [uid(req), drive.id, forms.serviceId, forms.triggerVersionId, scriptId, conn.auth_id, inputData, handler])
    res.status(201).json({ ok: true, subscription_id: sub.id })
  })

  r.delete('/drives/:driveId/google-form', async (req, res) => {
    const drive = await driveOf(req)
    const sub = await one(`select * from viasocket_subscriptions where drive_id = $1 and status = 'active'`, [drive.id])
    if (!sub) return res.status(404).json({ error: 'No Google Form connected' })
    await vs.setFlowStatus(uid(req), sub.script_id, 0)
    await query(`update viasocket_subscriptions set status = 'removed' where id = $1`, [sub.id])
    res.json({ ok: true })
  })

  /** A real event for the connected form, and how HireRelay would map it: lets HR verify the field mapping. */
  r.get('/drives/:driveId/google-form/sample', async (req, res) => {
    const drive = await driveOf(req)
    const sub = await one(`select * from viasocket_subscriptions where drive_id = $1 and status = 'active'`, [drive.id])
    if (!sub) return res.status(404).json({ error: 'No Google Form connected' })
    const event = await vs.sampleTriggerEvent(forms.triggerId, sub.auth_id, forms.authType, sub.input_data)
    const { viasocket_help, ...body } = event || {}
    res.json({ event: body, note: viasocket_help ?? null, mapped: mapSubmission(body, drive.field_map).columns })
  })

  /**
   * Adds the form's latest response as a candidate. Live delivery only covers responses submitted after syncing
   * started, so this is how an earlier response gets in. Same mapping, de-duplication and logging as live delivery.
   */
  r.post('/drives/:driveId/google-form/import-latest', async (req, res) => {
    const drive = await driveOf(req)
    const sub = await one(`select * from viasocket_subscriptions where drive_id = $1 and status = 'active'`, [drive.id])
    if (!sub) return res.status(404).json({ error: 'No Google Form connected' })
    const { viasocket_help, ...event } = (await vs.sampleTriggerEvent(forms.triggerId, sub.auth_id, forms.authType, sub.input_data)) || {}
    if (Object.keys(event).length && !isRealResponse(event) && !event.response) return res.status(404).json({ error: 'This form has no responses yet (viaSocket only returned a placeholder). Submit a response, then try again.' })
    if (!Object.keys(event).length || event.response?.status >= 400) return res.status(502).json({ error: event.response?.data?.message || 'viaSocket returned no response for this form. Submit a response to the form first.' })
    const result = await upsertFromSubmission({ drive, raw: event, source: 'google_forms', force: true }) // clicking Import means "add it", even if it was deleted before
    await logIngest(drive.owner_id, drive.id, 'google_forms', result, event)
    if (result.outcome === 'rejected') return res.status(422).json({ error: result.message })
    if (result.outcome === 'created') await afterCandidateCreated(drive, result.candidate)
    res.json({ outcome: result.outcome, name: result.candidate?.full_name ?? null })
  })
  return r
}

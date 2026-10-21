import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { start } from './helpers.js'
import { ingestKeyFor } from '../src/lib/ingestKey.js'
import { formsHandler } from '../src/lib/viasocket.js'

let t, drive
before(async () => { t = await start(); drive = (await t.a('POST', '/api/drives', { name: 'Support Walk-in', role_title: 'Support', venue: 'HQ', drive_date: '2026-11-01' })).body })
after(() => t.stop())

const ingest = (event, key = ingestKeyFor(drive.id)) => t.anon('POST', '/api/ingest/google-forms', { drive_id: drive.id, event }, { 'x-hirerelay-ingest-key': key })
const metrics = async (who = 'a') => (await t[who]('GET', '/api/dashboard')).body.metrics

test('requires auth for HR routes, none for health/config', async () => {
  assert.equal((await t.anon('GET', '/api/drives')).status, 401)
  assert.equal((await t.anon('GET', '/api/health')).status, 200)
  const cfg = (await t.anon('GET', '/api/config')).body
  assert.equal(cfg.setup.viasocketReady, false) // secret unset in tests
  assert.ok(!JSON.stringify(cfg).includes('test-ingest-secret'))
})

test('dashboard starts at zero from real data', async () => {
  const m = await metrics()
  assert.equal(m.total, 0); assert.equal(m.pending_feedback, 0)
})

test('Google Forms ingest: key required, candidate created, duplicate recognised', async () => {
  assert.equal((await ingest({ Name: 'x' }, 'bad')).status, 401)
  const event = { responseId: 'resp-1', Full_Name: 'Asha Rao', Email: 'asha@example.com', Phone: '+91 98765 43210', Role: 'Support' }
  const first = await ingest(event)
  assert.equal(first.status, 201); assert.equal(first.body.outcome, 'created')
  // same response id re-delivered, same email in a new response, same phone in a new response
  assert.equal((await ingest(event)).body.outcome, 'duplicate')
  assert.equal((await ingest({ responseId: 'resp-2', Full_Name: 'Asha R', Email: 'ASHA@example.com' })).body.outcome, 'duplicate')
  assert.equal((await ingest({ responseId: 'resp-3', Full_Name: 'Asha R', Phone: '09876543210' })).body.outcome, 'duplicate')
  assert.equal((await ingest({ responseId: 'resp-4', Note: 'no contact details' })).body.outcome, 'rejected')
  assert.equal((await metrics()).total, 1)
})

test('form sync never overwrites HR-managed state', async () => {
  const list = (await t.a('GET', '/api/candidates')).body
  const c = list[0]
  assert.equal(c.stage, 'registered')
  const iv = (await t.a('POST', '/api/interviewers', { name: 'Ivan', email: 'ivan@hr.test' })).body
  assert.equal((await t.a('POST', `/api/candidates/${c.id}/stage`, { stage: 'checked_in' })).status, 200)
  assert.equal((await t.a('POST', `/api/candidates/${c.id}/stage`, { stage: 'waiting' })).body.queue_number, 1)
  assert.equal((await t.a('PATCH', `/api/candidates/${c.id}/interviewer`, { interviewer_id: iv.id })).status, 200)
  // The form is re-submitted with changed data, including a new company: only blanks are filled.
  await ingest({ responseId: 'resp-9', Full_Name: 'Changed Name', Email: 'asha@example.com', Company: 'NewCo' })
  const after = (await t.a('GET', `/api/candidates/${c.id}`)).body
  assert.equal(after.stage, 'waiting'); assert.equal(after.queue_number, 1); assert.equal(after.interviewer_id, iv.id)
  assert.equal(after.full_name, 'Asha Rao'); assert.equal(after.current_company, 'NewCo')
})

test('stage machine and metrics', async () => {
  const c = (await t.a('GET', '/api/candidates')).body[0]
  const iv = (await t.a('GET', '/api/interviewers')).body[0]
  assert.equal((await t.a('POST', `/api/candidates/${c.id}/stage`, { stage: 'selected' })).status, 409)
  assert.equal((await metrics()).waiting, 1)
  assert.equal((await t.a('POST', `/api/candidates/${c.id}/stage`, { stage: 'in_interview', interviewer_id: iv.id })).status, 200)
  assert.equal((await t.a('POST', `/api/candidates/${c.id}/feedback`, { rating: 4, recommendation: 'hire' })).status, 409) // not completed yet
  assert.equal((await t.a('POST', `/api/candidates/${c.id}/stage`, { stage: 'completed' })).status, 200)
  let m = await metrics()
  assert.deepEqual([m.total, m.checked_in, m.waiting, m.completed, m.pending_feedback], [1, 1, 0, 1, 1])
  assert.equal((await t.a('POST', `/api/candidates/${c.id}/feedback`, { rating: 4, recommendation: 'hire', notes: 'Strong' })).status, 201)
  assert.equal((await t.a('POST', `/api/candidates/${c.id}/feedback`, { rating: 3, recommendation: 'hold' })).status, 409)
  m = await metrics(); assert.equal(m.pending_feedback, 0)
})

test('public registration form: validation, honeypot, duplicates do not leak', async () => {
  const url = `/api/public/drives/${drive.slug}`
  assert.equal((await t.anon('GET', url)).body.name, 'Support Walk-in')
  assert.equal((await t.anon('POST', `${url}/register`, { full_name: 'A' })).status, 400)
  assert.equal((await t.anon('POST', `${url}/register`, { full_name: 'No Contact' })).status, 422)
  const ok = await t.anon('POST', `${url}/register`, { full_name: 'Ravi Kumar', email: 'ravi@example.com', phone: '9000000001', experience_years: '2' })
  assert.equal(ok.status, 201)
  const dup = await t.anon('POST', `${url}/register`, { full_name: 'Ravi K', email: 'RAVI@example.com' })
  assert.equal(dup.status, 200); assert.equal(dup.body.outcome, 'already_registered')
  const bot = await t.anon('POST', `${url}/register`, { full_name: 'Bot Bot', email: 'bot@example.com', website: 'http://spam' })
  assert.equal(bot.status, 200)
  assert.equal((await t.a('GET', '/api/candidates?q=bot@example')).body.length, 0)
  await t.a('PATCH', `/api/drives/${drive.id}`, { status: 'closed' })
  assert.equal((await t.anon('GET', url)).status, 404)
  await t.a('PATCH', `/api/drives/${drive.id}`, { status: 'active' })
})

test('concurrent identical submissions create exactly one candidate', async () => {
  const body = { full_name: 'Race Condition', email: 'race@example.com' }
  const results = await Promise.all(Array.from({ length: 8 }, () => t.anon('POST', `/api/public/drives/${drive.slug}/register`, body)))
  assert.ok(results.every((r) => r.status === 200 || r.status === 201))
  assert.equal((await t.a('GET', '/api/candidates?q=race@example')).body.length, 1)
})

test('registration confirmations wait for approval; execution fails honestly without Gmail', async () => {
  const pending = (await t.a('GET', '/api/approvals?status=pending')).body
  assert.ok(pending.length >= 2)
  assert.ok(pending.every((a) => a.purpose === 'registration_confirmation' && a.payload.to))
  const r = await t.a('POST', `/api/approvals/${pending[0].id}/approve`)
  assert.equal(r.status, 200); assert.equal(r.body.status, 'failed')
  assert.match(r.body.error, /Gmail is not connected/)
  assert.equal((await t.a('POST', `/api/approvals/${pending[0].id}/approve`)).status, 409) // decided once
  const runs = (await t.a('GET', '/api/runs')).body
  assert.equal(runs[0].status, 'failed'); assert.ok(runs[0].finished_at)
  const rej = await t.a('POST', `/api/approvals/${pending[1].id}/reject`)
  assert.equal(rej.body.status, 'rejected')
})

test('prepare reminders queues approvals once, from real rows', async () => {
  const c = (await t.a('POST', '/api/candidates', { drive_id: drive.id, full_name: 'Queue Person', email: 'q@example.com' })).body
  await t.a('POST', `/api/candidates/${c.id}/stage`, { stage: 'checked_in' }); await t.a('POST', `/api/candidates/${c.id}/stage`, { stage: 'waiting' })
  const one = await t.a('POST', '/api/actions/prepare', { type: 'interview_reminders' })
  assert.equal(one.body.created, 1)
  assert.equal((await t.a('POST', '/api/actions/prepare', { type: 'interview_reminders' })).body.created, 0)
  assert.match(one.body.approvals[0].payload.body, /queue number/)
})

test('data is isolated per HR user', async () => {
  assert.equal((await t.b('GET', '/api/candidates')).body.length, 0)
  assert.equal((await t.b('GET', '/api/drives')).body.length, 0)
  const c = (await t.a('GET', '/api/candidates')).body[0]
  assert.equal((await t.b('GET', `/api/candidates/${c.id}`)).status, 404)
  assert.equal((await t.b('POST', `/api/candidates/${c.id}/stage`, { stage: 'no_show' })).status, 404)
  assert.equal((await t.b('GET', `/api/drives/${drive.id}`)).status, 404)
  assert.equal((await metrics('b')).total, 0)
})

test('viaSocket and agent endpoints state what is missing instead of faking success', async () => {
  const s = (await t.a('GET', '/api/viasocket/status')).body
  assert.equal(s.configured, false); assert.deepEqual(s.missing, ['VIASOCKET_EMBED_SECRET'])
  assert.deepEqual(s.apps.map((a) => a.connected), [false, false])
  const tok = await t.a('GET', '/api/viasocket/token')
  assert.equal(tok.status, 503); assert.equal(tok.body.code, 'viasocket_not_configured')
  const ag = await t.a('POST', '/api/agent/message', { message: 'How many are waiting?', thread_id: 'main' })
  assert.equal(ag.status, 503); assert.match(ag.body.error, /VIASOCKET_EMBED_SECRET/)
  const g = await t.a('POST', `/api/viasocket/drives/${drive.id}/google-form`, { form_id: 'abc' })
  assert.equal(g.status, 409)
  assert.equal((await t.a('POST', '/api/viasocket/connected', { serviceId: 'rowo0bqrhj5g', authId: 'x_rowo0bqrhj5g' })).status, 503)
})

test('viaSocket handler is valid JavaScript with the key and drive baked in', () => {
  const code = formsHandler({ ingestUrl: 'https://x.test/api/ingest/google-forms', driveId: drive.id, ingestKey: 'k' })
  const AsyncFn = Object.getPrototypeOf(async function () {}).constructor
  assert.doesNotThrow(() => new AsyncFn('context', 'axios', code))
  assert.ok(code.includes(drive.id) && code.includes('x-hirerelay-ingest-key'))
})

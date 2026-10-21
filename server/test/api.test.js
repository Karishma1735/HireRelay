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

test('accounts: signup validates, login checks the password, sessions gate HR routes', async () => {
  assert.equal((await t.anon('POST', '/api/auth/signup', { email: 'x@hr.test', password: 'short' })).status, 400)
  assert.equal((await t.anon('POST', '/api/auth/signup', { email: 'A@hr.test', password: 'correct-horse-9' })).status, 409) // case-insensitive duplicate
  const ok = await t.anon('POST', '/api/auth/login', { email: 'a@hr.test', password: 'correct-horse-9' })
  assert.equal(ok.status, 200); assert.ok(ok.body.token)
  assert.equal((await t.anon('POST', '/api/auth/login', { email: 'a@hr.test', password: 'wrong-password' })).status, 401)
  assert.equal((await t.anon('POST', '/api/auth/login', { email: 'nobody@hr.test', password: 'correct-horse-9' })).status, 401)
  assert.equal((await t.anon('GET', '/api/drives', undefined, { authorization: 'Bearer garbage' })).status, 401)
  assert.equal((await fetchWith(ok.body.token)).status, 200)
})

const fetchWith = (token) => t.anon('GET', '/api/drives', undefined, { authorization: `Bearer ${token}` })

test('requires auth for HR routes, none for health/config', async () => {
  assert.equal((await t.anon('GET', '/api/drives')).status, 401)
  assert.equal((await t.anon('GET', '/api/health')).status, 200)
  const cfg = (await t.anon('GET', '/api/config')).body
  assert.equal(cfg.setup.viasocketReady, false) // secret unset in tests
  assert.ok(!JSON.stringify(cfg).includes('test-ingest-secret'))
  assert.ok(!('supabaseUrl' in cfg))
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

test('agent snapshot and the queries it feeds run against real data', async () => {
  const { buildSnapshot, validProposals } = await import('../src/lib/agent.js')
  const { one } = await import('../src/db.js')
  const snap = await buildSnapshot(t.users.a.id)
  assert.equal(snap.metrics.total, (await metrics()).total)
  assert.ok(snap.waiting_list.length >= 1) // "Queue Person" is waiting from an earlier test
  const w = snap.waiting_list[0]
  const c = await one(`select c.*, json_object('name', d.name, 'role_title', d.role_title, 'venue', d.venue, 'drive_date', d.drive_date) as drive from candidates c join drives d on d.id = c.drive_id where c.id = $1 and c.owner_id = $2 and c.email is not null`, [w.id, t.users.a.id])
  assert.equal(c.drive.name, 'Support Walk-in')
  // Proposals pointing at rows that are not in the snapshot are dropped.
  const kept = validProposals([{ type: 'interview_reminder', candidate_id: w.id }, { type: 'interview_reminder', candidate_id: 'made-up' }, { type: 'feedback_reminder', interviewer_id: 'nope' }], snap)
  assert.equal(kept.length, 1)
})

test('an email only counts as sent when Gmail returns a message id (viaSocket answers 200 even on app errors)', async () => {
  const { query } = await import('../src/db.js')
  await query(`insert into viasocket_connections (owner_id, service_id, auth_id, script_id, config) values ($1,'rowo0bqrhj5g','auth_rowo0bqrhj5g','scriTEST',$2)`, [t.users.a.id, { from: 'me@example.com' }])
  const realFetch = globalThis.fetch
  const answer = (body) => { globalThis.fetch = async (url, init) => String(url).includes('/func/scriTEST') ? new Response(JSON.stringify(body), { status: 200 }) : realFetch(url, init) }
  const queue = async () => (await t.a('POST', '/api/candidates', { drive_id: drive.id, full_name: `Mail Test ${Math.random()}`, email: `m${Math.random().toString(36).slice(2)}@example.com` })).body
  try {
    const pending = async () => (await t.a('GET', '/api/approvals?status=pending')).body[0]
    await queue(); answer({ success: true, data: { response: { status: 400, data: { message: 'Invalid from address' } } } })
    const bad = await t.a('POST', `/api/approvals/${(await pending()).id}/approve`)
    assert.equal(bad.body.status, 'failed'); assert.match(bad.body.error, /Invalid from address/)
    await queue(); answer({ success: true, data: { ok: 'but no message id' } })
    const noId = await t.a('POST', `/api/approvals/${(await pending()).id}/approve`)
    assert.equal(noId.body.status, 'failed'); assert.match(noId.body.error, /message id/)
    await queue(); answer({ success: true, data: { id: 'm_1', labelIds: ['SENT'], threadId: 't_1' } })
    const good = await t.a('POST', `/api/approvals/${(await pending()).id}/approve`)
    assert.equal(good.body.status, 'executed')
    // a failed one can be retried and now succeeds
    const again = await t.a('POST', `/api/approvals/${bad.body.id}/retry`)
    assert.equal(again.body.status, 'executed')
  } finally { globalThis.fetch = realFetch }
})

test('deleting candidates removes them, their feedback and pending emails, and respects ownership', async () => {
  const mk = async (name) => (await t.a('POST', '/api/candidates', { drive_id: drive.id, full_name: name, email: `${name.replace(' ', '').toLowerCase()}@example.com` })).body
  const [x, y] = [await mk('Delete One'), await mk('Delete Two')]
  const before = (await metrics()).total
  assert.ok((await t.a('GET', '/api/approvals?status=pending')).body.some((a) => a.candidate_id === x.id))
  assert.equal((await t.b('DELETE', `/api/candidates/${x.id}`)).status, 404) // not theirs
  assert.equal((await t.a('DELETE', `/api/candidates/${x.id}`)).status, 200)
  assert.equal((await t.a('DELETE', `/api/candidates/${x.id}`)).status, 404)
  assert.ok(!(await t.a('GET', '/api/approvals?status=pending')).body.some((a) => a.candidate_id === x.id)) // queued email gone
  const bulk = await t.a('POST', '/api/candidates/delete', { ids: [y.id, x.id, '00000000-0000-4000-8000-000000000000'] })
  assert.equal(bulk.body.deleted, 1)
  assert.equal((await metrics()).total, before - 2)
  assert.equal((await t.b('POST', '/api/candidates/delete', { ids: [(await t.a('GET', '/api/candidates')).body[0].id] })).body.deleted, 0)
})

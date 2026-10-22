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
  // Default behaviour: checking in puts the candidate straight into the queue.
  const checkedIn = await t.a('POST', `/api/candidates/${c.id}/stage`, { stage: 'checked_in' })
  assert.equal(checkedIn.status, 200); assert.equal(checkedIn.body.stage, 'waiting'); assert.equal(checkedIn.body.queue_number, 1)
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
  await t.a('POST', `/api/candidates/${c.id}/stage`, { stage: 'checked_in' }) // auto-queues
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

test('agent summary and proposal checks run against real data', async () => {
  const { buildSnapshot, validProposals } = await import('../src/lib/agent.js')
  const snap = await buildSnapshot(t.users.a.id)
  assert.equal(snap.totals.total, (await metrics()).total)
  assert.ok(snap.waiting_now.length >= 1) // "Queue Person" is waiting from an earlier test
  const w = snap.waiting_now[0]
  // Proposals must point at real rows owned by this user, in the right state; anything else is dropped.
  const kept = await validProposals(t.users.a.id, [{ type: 'interview_reminder', candidate_id: w.id }, { type: 'interview_reminder', candidate_id: 'made-up' }, { type: 'feedback_reminder', interviewer_id: 'nope' }])
  assert.equal(kept.length, 1)
  assert.equal((await validProposals(t.users.b.id, [{ type: 'interview_reminder', candidate_id: w.id }])).length, 0) // another user's candidate
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
  } finally { globalThis.fetch = realFetch; await query('delete from viasocket_connections') }
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


test('check-in joins the queue and emails the queue number; both behaviours are switchable', async () => {
  const mk = async (name) => (await t.a('POST', '/api/candidates', { drive_id: drive.id, full_name: name, email: `${name.replace(/\s/g, '').toLowerCase()}@example.com` })).body
  const before = (await t.a('GET', '/api/settings')).body
  assert.deepEqual([before.auto_queue_on_check_in, before.auto_send_queue_emails], [true, true]) // defaults
  const [a, b] = [await mk('Queue Alpha'), await mk('Queue Beta')]
  const nums = []
  for (const c of [a, b]) nums.push((await t.a('POST', `/api/candidates/${c.id}/stage`, { stage: 'checked_in' })).body)
  assert.deepEqual(nums.map((n) => n.stage), ['waiting', 'waiting'])
  assert.equal(nums[1].queue_number, nums[0].queue_number + 1)
  // The queue email was created for each, carries the real number and people ahead, and (auto-send on) was attempted at once.
  const all = (await t.a('GET', '/api/approvals')).body
  const mailB = all.find((x) => x.candidate_id === b.id && x.payload.subject.includes('queue number'))
  assert.ok(mailB.title.includes(`#${nums[1].queue_number}`)); assert.match(mailB.payload.body, new RegExp(`#${nums[1].queue_number}`)); assert.match(mailB.payload.body, /ahead of you/)
  for (let i = 0; i < 20 && ['pending', 'approved'].includes((await t.a('GET', '/api/approvals')).body.find((x) => x.id === mailB.id).status); i++) await new Promise((r) => setTimeout(r, 100))
  const sent = (await t.a('GET', '/api/approvals')).body.find((x) => x.id === mailB.id)
  assert.notEqual(sent.status, 'pending') // auto-sent: no Gmail in tests, so it must fail honestly
  assert.match(sent.error, /Gmail is not connected/)

  // Switch both off: check-in stays a plain check-in, and Add to queue then sends the email for approval.
  await t.a('PUT', '/api/settings', { auto_queue_on_check_in: false, auto_send_queue_emails: false })
  const c = await mk('Queue Gamma')
  assert.equal((await t.a('POST', `/api/candidates/${c.id}/stage`, { stage: 'checked_in' })).body.stage, 'checked_in')
  assert.equal((await t.a('GET', '/api/approvals')).body.some((x) => x.candidate_id === c.id && x.payload.subject.includes('queue number')), false)
  const queued = (await t.a('POST', `/api/candidates/${c.id}/stage`, { stage: 'waiting' })).body
  assert.ok(queued.queue_number > nums[1].queue_number)
  const pendingMail = (await t.a('GET', '/api/approvals?status=pending')).body.find((x) => x.candidate_id === c.id && x.payload.subject.includes('queue number'))
  assert.ok(pendingMail, 'waits for approval when auto-send is off')
  // A candidate without an email is queued but nobody is emailed.
  const noMail = (await t.a('POST', '/api/candidates', { drive_id: drive.id, full_name: 'No Email', phone: '9111111111' })).body
  await t.a('POST', `/api/candidates/${noMail.id}/stage`, { stage: 'checked_in' }); await t.a('POST', `/api/candidates/${noMail.id}/stage`, { stage: 'waiting' })
  assert.equal((await t.a('GET', '/api/approvals')).body.some((x) => x.candidate_id === noMail.id), false)
  await t.a('PUT', '/api/settings', { auto_queue_on_check_in: true, auto_send_queue_emails: true })
  assert.equal((await t.a('GET', '/api/settings')).body.auto_queue_on_check_in, true)
  assert.equal((await t.b('GET', '/api/settings')).body.auto_queue_on_check_in, true) // other users unaffected
})

test('interviewers report live counts and filter their own candidates', async () => {
  const iv = (await t.a('POST', '/api/interviewers', { name: 'Counts Panelist', email: 'counts@hr.test' })).body
  const other = (await t.a('POST', '/api/interviewers', { name: 'Other Panelist' })).body
  const mk = async (name) => (await t.a('POST', '/api/candidates', { drive_id: drive.id, full_name: name, email: `${name.replace(/\s/g, '').toLowerCase()}@example.com` })).body
  const people = [await mk('Count A'), await mk('Count B'), await mk('Count C'), await mk('Count D')]
  for (const c of people) await t.a('PATCH', `/api/candidates/${c.id}/interviewer`, { interviewer_id: iv.id })
  await t.a('PATCH', `/api/candidates/${people[3].id}/interviewer`, { interviewer_id: other.id }) // belongs to someone else
  const stage = (c, s) => t.a('POST', `/api/candidates/${c.id}/stage`, { stage: s })
  await stage(people[0], 'checked_in')                      // auto-queued -> waiting
  await stage(people[1], 'checked_in'); await stage(people[1], 'in_interview')
  await stage(people[2], 'checked_in'); await stage(people[2], 'in_interview'); await stage(people[2], 'completed') // done, feedback due
  const stats = (await t.a('GET', `/api/interviewers/${iv.id}`)).body
  assert.deepEqual([stats.assigned, stats.waiting, stats.in_interview, stats.interviewed, stats.feedback_due], [3, 1, 1, 1, 1])
  await t.a('POST', `/api/candidates/${people[2].id}/feedback`, { rating: 5, recommendation: 'hire' })
  assert.equal((await t.a('GET', `/api/interviewers/${iv.id}`)).body.feedback_due, 0)
  assert.equal((await t.a('GET', '/api/interviewers')).body.find((x) => x.id === iv.id).assigned, 3) // list shows the same numbers
  const mine = (await t.a('GET', `/api/candidates?interviewer_id=${iv.id}`)).body
  assert.deepEqual(mine.map((c) => c.full_name).sort(), ['Count A', 'Count B', 'Count C'])
  assert.equal((await t.b('GET', `/api/interviewers/${iv.id}`)).status, 404) // another HR user cannot see it
  assert.equal((await t.b('GET', `/api/candidates?interviewer_id=${iv.id}`)).body.length, 0)
})

test('dashboard sync list drops deleted candidates and no longer carries workflow runs', async () => {
  const { query } = await import('../src/db.js')
  const created = (await t.anon('POST', `/api/public/drives/${drive.slug}/register`, { full_name: 'Soon Deleted', email: 'soondeleted@example.com' }))
  assert.equal(created.status, 201)
  const names = async () => (await t.a('GET', '/api/dashboard')).body.recent_sync.map((e) => e.full_name)
  assert.ok((await names()).includes('Soon Deleted'))
  const c = (await t.a('GET', '/api/candidates?q=soondeleted')).body[0]
  assert.equal((await t.a('DELETE', `/api/candidates/${c.id}`)).status, 200)
  assert.ok(!(await names()).includes('Soon Deleted'))
  assert.equal(await query('select 1 from ingest_events where candidate_id = $1', [c.id]).then((r) => r.rows.length), 0) // log entry removed too
  // Entries orphaned by earlier deletions (created, but no candidate) stay hidden; rejected submissions still show.
  await query(`insert into ingest_events (owner_id, drive_id, source, outcome, message) values ($1,$2,'form','created','ghost')`, [t.users.a.id, drive.id])
  await t.anon('POST', `/api/public/drives/${drive.slug}/register`, { full_name: 'No Contact Details' })      // rejected: needs email or phone
  const feed = (await t.a('GET', '/api/dashboard')).body.recent_sync
  assert.ok(feed.every((e) => e.full_name || e.outcome === 'rejected'), 'no nameless rows except rejected ones')
  assert.ok(!feed.some((e) => e.message === 'ghost'))
  assert.equal((await t.a('GET', '/api/ingest-events')).body.some((e) => e.message === 'ghost'), false) // same rule in the Form sync log tab
  assert.equal('recent_runs' in (await t.a('GET', '/api/dashboard')).body, false)
})

test('dashboard carries real chart data: timeline, live interviews, interviewer load, timings', async () => {
  const d = (await t.a('GET', '/api/dashboard')).body
  assert.equal(d.timeline.length, 14)
  assert.equal(d.timeline.at(-1).day, new Date().toISOString().slice(0, 10))
  const total = d.timeline.reduce((n, x) => n + x.count, 0)
  assert.ok(total > 0 && total <= d.metrics.total, 'timeline counts only candidates that exist')
  assert.deepEqual(Object.keys(d.setup).sort(), ['candidates', 'drives', 'interviewers'])
  assert.ok(d.setup.drives >= 1 && d.setup.candidates === d.metrics.total)
  for (const l of d.interviewer_load) assert.ok(l.done >= 0 && l.running >= 0 && l.not_started >= 0)
  const busy = d.interviewer_load.find((l) => l.name === 'Counts Panelist')
  assert.ok(busy && busy.done === 1 && busy.running === 1, JSON.stringify(busy)) // from the interviewer-count test
  assert.ok(d.in_interview.some((c) => c.interviewer === 'Counts Panelist'))
  assert.ok(d.metrics.avg_interview_min === null || d.metrics.avg_interview_min >= 0)
  const scoped = (await t.a('GET', `/api/dashboard?drive_id=${drive.id}`)).body
  assert.equal(scoped.timeline.length, 14)
  assert.equal((await t.b('GET', '/api/dashboard')).body.timeline.every((x) => x.count === 0), true) // other user sees nothing of ours
})

test('importing the latest Google Form response adds it once, with the same mapping and de-duplication as live delivery', async () => {
  const { query } = await import('../src/db.js')
  await query(`insert into viasocket_subscriptions (owner_id, drive_id, service_id, trigger_version_id, script_id, auth_id, input_data, handler) values ($1,$2,'rowshu8t54lr','row5hkzp1usn','scriSUB','auth_rowshu8t54lr',$3,'x')`, [t.users.a.id, drive.id, { id: 'form1' }])
  const realFetch = globalThis.fetch
  const event = { responseId: 'resp-import-1', createTime: 'x', Full_Name: 'Karishma S', Email: 'karishma.import@example.com', Phone_No_: '9090909056', College: 'IIT' }
  globalThis.fetch = async (url, init) => String(url).includes('/func/scrijZpnr8zJ') ? new Response(JSON.stringify({ ...event, viasocket_help: 'sample' }), { status: 200 }) : realFetch(url, init)
  try {
    const first = await t.a('POST', `/api/viasocket/drives/${drive.id}/google-form/import-latest`)
    assert.deepEqual([first.status, first.body.outcome, first.body.name], [200, 'created', 'Karishma S'])
    const c = (await t.a('GET', '/api/candidates?q=karishma.import')).body[0]
    assert.deepEqual([c.phone, c.source, c.extra.College], ['9090909056', 'google_forms', 'IIT'])
    assert.equal((await t.a('POST', `/api/viasocket/drives/${drive.id}/google-form/import-latest`)).body.outcome, 'duplicate') // same response again
    assert.equal((await t.a('GET', '/api/candidates?q=karishma.import')).body.length, 1)
    assert.equal((await t.a('GET', `/api/drives/${drive.id}`)).body.last_form_event.outcome, 'duplicate') // shows delivery status
    assert.equal((await t.b('POST', `/api/viasocket/drives/${drive.id}/google-form/import-latest`)).status, 404) // not their drive
    globalThis.fetch = async (url, init) => String(url).includes('/func/scrijZpnr8zJ') ? new Response(JSON.stringify({}), { status: 200 }) : realFetch(url, init)
    assert.equal((await t.a('POST', `/api/viasocket/drives/${drive.id}/google-form/import-latest`)).status, 502) // nothing to import: says so
  } finally { globalThis.fetch = realFetch; await query('delete from viasocket_subscriptions') }
})

test('form poller adds genuinely new responses once, and ignores stand-ins and older responses', async () => {
  const { query } = await import('../src/db.js')
  const { pollOnce } = await import('../src/lib/formPoller.js')
  await query(`insert into viasocket_subscriptions (owner_id, drive_id, service_id, trigger_version_id, script_id, auth_id, input_data, handler) values ($1,$2,'rowshu8t54lr','row5hkzp1usn','scriPOLL','auth_rowshu8t54lr',$3,'x')`, [t.users.a.id, drive.id, { id: 'form1' }])
  const realFetch = globalThis.fetch; let reply
  globalThis.fetch = async (url, init) => String(url).includes('/func/scrijZpnr8zJ') ? new Response(JSON.stringify(reply), { status: 200 }) : realFetch(url, init)
  const count = async () => (await t.a('GET', '/api/candidates?q=poller')).body.length
  const now = new Date().toISOString()
  try {
    reply = { responseId: 'sampleId', createTime: now, Domain_to_be_enabled: 'example.org', viasocket_help: 'stand-in' }
    assert.equal(await pollOnce(), 0)                                                    // placeholder sample: ignored
    reply = { responseId: 'old-1', createTime: '2020-01-01T00:00:00Z', Full_Name: 'Poller Old', Email: 'poller.old@example.com' }
    assert.equal(await pollOnce(), 0)                                                    // submitted before syncing started: left for manual import
    reply = { responseId: 'new-1', createTime: now, Full_Name: 'Poller New', Email: 'poller.new@example.com', Phone_No_: '9000011111' }
    assert.equal(await pollOnce(), 1); assert.equal(await count(), 1)                    // appears without any click
    assert.equal(await pollOnce(), 0); assert.equal(await count(), 1)                    // same response next tick: nothing
    reply = { responseId: 'new-2', createTime: now, Full_Name: 'Poller Same Person', Email: 'POLLER.NEW@example.com' }
    assert.equal(await pollOnce(), 0); assert.equal(await count(), 1)                    // same email again: duplicate, not a second candidate
    const mail = (await t.a('GET', '/api/approvals?status=pending')).body.filter((a) => a.payload.to === 'poller.new@example.com')
    assert.equal(mail.length, 1)                                                          // one confirmation, not two
    // The manual import refuses a placeholder too.
    reply = { responseId: 'sampleId', createTime: now, Domain_to_be_enabled: 'example.org' }
    assert.equal((await t.a('POST', `/api/viasocket/drives/${drive.id}/google-form/import-latest`)).status, 404)
  } finally { globalThis.fetch = realFetch; await query('delete from viasocket_subscriptions') }
})

test('a deleted Google Form candidate stays deleted, however often the same response is delivered again', async () => {
  const { query } = await import('../src/db.js')
  const { pollOnce } = await import('../src/lib/formPoller.js')
  const ev = { responseId: 'resp-gone-1', createTime: new Date().toISOString(), Full_Name: 'Comes Back', Email: 'comesback@example.com', Phone_No_: '9000022222' }
  const count = async () => (await t.a('GET', '/api/candidates?q=comesback')).body.length
  assert.equal((await ingest(ev)).body.outcome, 'created')
  const c = (await t.a('GET', '/api/candidates?q=comesback')).body[0]
  assert.equal((await t.a('DELETE', `/api/candidates/${c.id}`)).status, 200)
  // viaSocket delivers the same response again (retry, restart, re-sync): it must not resurrect the candidate.
  assert.equal((await ingest(ev)).body.outcome, 'skipped'); assert.equal(await count(), 0)
  // The 30-second check, even after the app restarted (a fresh process has no memory of the response).
  await query(`insert into viasocket_subscriptions (owner_id, drive_id, service_id, trigger_version_id, script_id, auth_id, input_data, handler) values ($1,$2,'rowshu8t54lr','row5hkzp1usn','scriGONE','auth_rowshu8t54lr',$3,'x')`, [t.users.a.id, drive.id, { id: 'form1' }])
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => String(url).includes('/func/scrijZpnr8zJ') ? new Response(JSON.stringify(ev), { status: 200 }) : realFetch(url, init)
  try {
    assert.equal(await pollOnce(), 0); assert.equal(await count(), 0)
    // Deleting many at once is remembered too.
    assert.equal((await ingest({ ...ev, responseId: 'resp-gone-2', Email: 'comesback2@example.com', Phone_No_: '9000033333' })).body.outcome, 'created')
    const c2 = (await t.a('GET', '/api/candidates?q=comesback2')).body[0]
    await t.a('POST', '/api/candidates/delete', { ids: [c2.id] })
    assert.equal((await ingest({ ...ev, responseId: 'resp-gone-2', Email: 'comesback2@example.com', Phone_No_: '9000033333' })).body.outcome, 'skipped')
    // A genuinely new response from the same person is a new registration and is accepted.
    assert.equal((await ingest({ ...ev, responseId: 'resp-gone-3' })).body.outcome, 'created')
    assert.equal(await count(), 1)
    // Importing by hand is an explicit "add it back": it overrides the memory of the deletion.
    await t.a('DELETE', `/api/candidates/${(await t.a('GET', '/api/candidates?q=comesback')).body[0].id}`)
    reply2 = { ...ev, responseId: 'resp-gone-3' }
    globalThis.fetch = async (url, init) => String(url).includes('/func/scrijZpnr8zJ') ? new Response(JSON.stringify(reply2), { status: 200 }) : realFetch(url, init)
    assert.equal((await t.a('POST', `/api/viasocket/drives/${drive.id}/google-form/import-latest`)).body.outcome, 'created')
  } finally { globalThis.fetch = realFetch; await query('delete from viasocket_subscriptions') }
})
let reply2

test('assigning an interviewer emails the candidate (once per real change), and respects the setting', async () => {
  const mail = async (cid) => (await t.a('GET', '/api/approvals')).body.filter((x) => x.candidate_id === cid && /nterviewer/.test(x.payload.subject))
  const settle = async (cid, n) => { for (let i = 0; i < 30 && !((await mail(cid)).length === n && (await mail(cid)).every((m) => !['pending', 'approved'].includes(m.status) || m.status === 'pending')); i++) await new Promise((r) => setTimeout(r, 100)) }
  const iv1 = (await t.a('POST', '/api/interviewers', { name: 'Assign One', email: 'a1@hr.test' })).body
  const iv2 = (await t.a('POST', '/api/interviewers', { name: 'Assign Two' })).body
  const c = (await t.a('POST', '/api/candidates', { drive_id: drive.id, full_name: 'Assign Me', email: 'assignme@example.com' })).body
  const set = (who, iv) => t.a('PATCH', `/api/candidates/${c.id}/interviewer`, { interviewer_id: iv })
  assert.equal((await mail(c.id)).length, 0)
  assert.equal((await set('a', iv1.id)).status, 200)
  let m = await mail(c.id); assert.equal(m.length, 1)
  assert.equal(m[0].payload.to, 'assignme@example.com'); assert.match(m[0].payload.subject, /Your interviewer: Assign One/); assert.match(m[0].payload.body, /Assign One/)
  await settle(c.id, 1); m = await mail(c.id)
  assert.equal(m[0].status, 'failed'); assert.match(m[0].error, /Gmail is not connected/) // auto-sent (default); no Gmail in tests, so it fails honestly
  await set('a', iv1.id); assert.equal((await mail(c.id)).length, 1)               // same interviewer again: no second email
  await set('a', iv2.id); m = await mail(c.id); assert.equal(m.length, 2)
  assert.ok(m.some((x) => /has changed: Assign Two/.test(x.payload.subject)))      // a change says so
  await set('a', null); assert.equal((await mail(c.id)).length, 2)                 // removing an interviewer: nothing to say
  // Setting off: the email waits for approval instead of going out.
  await t.a('PUT', '/api/settings', { auto_send_assignment_emails: false })
  await set('a', iv1.id)
  const waiting = (await mail(c.id)).filter((x) => x.status === 'pending'); assert.equal(waiting.length, 1)
  await t.a('PUT', '/api/settings', { auto_send_assignment_emails: true })
  // No email address, or an interview already finished: no email.
  const noMail = (await t.a('POST', '/api/candidates', { drive_id: drive.id, full_name: 'No Mail Person', phone: '9222222222' })).body
  await t.a('PATCH', `/api/candidates/${noMail.id}/interviewer`, { interviewer_id: iv1.id })
  const forNoMail = (await t.a('GET', '/api/approvals')).body.filter((x) => x.candidate_id === noMail.id)
  assert.deepEqual(forNoMail.map((x) => x.payload.to), ['a1@hr.test']) // nothing to the candidate (no address), but the interviewer is still briefed
  const done = (await t.a('POST', '/api/candidates', { drive_id: drive.id, full_name: 'Done Person', email: 'doneperson@example.com' })).body
  await t.a('PATCH', `/api/candidates/${done.id}/interviewer`, { interviewer_id: iv2.id })
  const before = (await mail(done.id)).length
  for (const s of ['checked_in', 'in_interview', 'completed']) await t.a('POST', `/api/candidates/${done.id}/stage`, { stage: s })
  await t.a('PATCH', `/api/candidates/${done.id}/interviewer`, { interviewer_id: iv1.id })
  assert.equal((await mail(done.id)).length, before)
})


// ---------- agent lookup tools ----------
const tool = (token, name, body = {}) => fetch(`${t.base}/api/agent-tools/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }))

test('agent tools: only a valid tool token works, never a login session, and never across users', async () => {
  const { signToolToken } = await import('../src/auth.js')
  const jwt = (await import('jsonwebtoken')).default
  const tokenA = signToolToken(t.users.a.id)
  assert.equal((await tool(null, 'get_overview')).status, 401)
  assert.equal((await tool('garbage', 'get_overview')).status, 401)
  const session = (await t.anon('POST', '/api/auth/login', { email: 'a@hr.test', password: 'correct-horse-9' })).body.token
  assert.equal((await tool(session, 'get_overview')).status, 401)                                  // a login session is not a tool token
  const login = await t.anon('GET', '/api/drives', undefined, { authorization: `Bearer ${tokenA}` })
  assert.equal(login.status, 401)                                                                  // and a tool token is not a login
  const expired = jwt.sign({ sub: t.users.a.id, aud: 'agent-tools', exp: Math.floor(Date.now() / 1000) - 5 }, 'x')
  assert.equal((await tool(expired, 'get_overview')).status, 401)
  assert.equal((await tool(tokenA, 'nope')).status, 404)
  assert.equal((await tool(tokenA, 'constructor')).status, 404)
  assert.equal((await tool(tokenA, 'get_overview')).status, 200)
  const a = (await tool(tokenA, 'search_candidates', { limit: 50 })).body, b = (await tool(signToolToken(t.users.b.id), 'search_candidates', { limit: 50 })).body
  assert.ok(a.total_matching > 0); assert.equal(b.total_matching, 0)                               // user B sees none of A's candidates
  assert.equal((await tool(tokenA, 'search_candidates', { stage: 'bogus' })).status, 400)          // bad arguments are explained, not crashed on
})

test('agent tools answer the questions the old summary could not', async () => {
  const { signToolToken } = await import('../src/auth.js')
  const tok = signToolToken(t.users.a.id)
  const mk = async (name) => (await t.a('POST', '/api/candidates', { drive_id: drive.id, full_name: name, email: `${name.replace(/\s/g, '').toLowerCase()}@example.com` })).body
  const iv = (await t.a('POST', '/api/interviewers', { name: 'Tool Panelist', email: 'toolp@hr.test' })).body
  const [x, y] = [await mk('Reject First'), await mk('Reject Latest')]
  for (const c of [x, y]) { await t.a('PATCH', `/api/candidates/${c.id}/interviewer`, { interviewer_id: iv.id }); for (const st of ['checked_in', 'in_interview', 'completed']) await t.a('POST', `/api/candidates/${c.id}/stage`, { stage: st }) }
  await t.a('POST', `/api/candidates/${x.id}/stage`, { stage: 'rejected' })
  await new Promise((r) => setTimeout(r, 15))
  await t.a('POST', `/api/candidates/${y.id}/stage`, { stage: 'rejected' })
  await t.a('POST', `/api/candidates/${y.id}/feedback`, { rating: 2, recommendation: 'reject', notes: 'Not a fit for support' })

  // "give me the latest rejected candidate"
  const latest = (await tool(tok, 'search_candidates', { stage: 'rejected', limit: 1 })).body
  assert.equal(latest.total_matching, 2); assert.equal(latest.candidates[0].name, 'Reject Latest'); assert.equal(latest.candidates[0].interviewer, 'Tool Panelist')
  assert.equal(latest.candidates[0].recommendation, 'reject')
  // by name, by interviewer, by feedback state, by registration date, "no interviewer"
  assert.equal((await tool(tok, 'search_candidates', { query: 'reject f' })).body.candidates[0].name, 'Reject First')
  assert.equal((await tool(tok, 'search_candidates', { interviewer: 'tool pan' })).body.total_matching, 2)
  assert.deepEqual((await tool(tok, 'search_candidates', { feedback: 'pending', interviewer: 'Tool' })).body.candidates.map((c) => c.name), ['Reject First'])
  assert.ok((await tool(tok, 'search_candidates', { registered_since: '2999-01-01' })).body.total_matching === 0)
  assert.ok((await tool(tok, 'search_candidates', { interviewer: 'none' })).body.candidates.every((c) => c.interviewer === null))
  assert.equal((await tool(tok, 'search_candidates', { stage: '', drive: '', limit: '3' })).body.returned, 3)       // empty strings and numeric strings from the model are fine
  // one candidate in full: answers, feedback, emails
  const one = (await tool(tok, 'get_candidate', { name: 'Reject Latest' })).body
  assert.equal(one.found, true); assert.equal(one.feedback.notes, 'Not a fit for support'); assert.ok(Array.isArray(one.emails))
  assert.equal((await tool(tok, 'get_candidate', { name: 'Reject' })).body.found, false)                           // two matches: asks which one
  assert.equal((await tool(tok, 'get_candidate', { name: 'Nobody Here' })).body.found, false)
  assert.equal((await tool(tok, 'get_candidate', { candidate_id: y.id })).body.candidate.name, 'Reject Latest')
  // the rest of the toolbox
  assert.ok((await tool(tok, 'list_feedback', { recommendation: 'reject' })).body.feedback.some((f) => f.candidate === 'Reject Latest'))
  const drives = (await tool(tok, 'list_drives')).body.drives; assert.ok(drives[0].rejected >= 2 && drives[0].candidates >= 2)
  assert.ok((await tool(tok, 'list_interviewers')).body.interviewers.some((i) => i.name === 'Tool Panelist' && i.assigned === 2 && i.feedback_owed === 1))
  assert.ok(Array.isArray((await tool(tok, 'list_emails', { status: 'failed' })).body.emails))
  assert.ok((await tool(tok, 'recent_activity')).body.activity.every((e) => e.candidate || e.outcome === 'rejected'))
  const ov = (await tool(tok, 'get_overview')).body; assert.equal(ov.by_stage.rejected, 2)
})

test('the agent request carries the tools, a short-lived token for this user, and a natural prompt', async () => {
  const { verifyToolToken } = await import('../src/auth.js')
  process.env.VIASOCKET_EMBED_SECRET = 'unit-test-secret'; process.env.HIRERELAY_PUBLIC_URL = 'https://hirerelay.example.test'
  const realFetch = globalThis.fetch; let sent
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/embed/ai/message')) { sent = JSON.parse(init.body); return new Response(JSON.stringify({ success: true, data: { content: JSON.stringify({ answer: 'Reject Latest was the most recent rejection.', recommendations: [], proposed_actions: [{ type: 'interview_reminder', candidate_id: 'made-up', interviewer_id: null, reason: 'x' }] }) } }), { status: 200 }) }
    return realFetch(url, init)
  }
  try {
    const r = await t.a('POST', '/api/agent/message', { message: 'give me the latest rejected candidate', thread_id: 'toolcheck' })
    assert.equal(r.status, 200); assert.match(r.body.answer, /Reject Latest/)
    assert.deepEqual(r.body.queued_approvals, [])                                                    // a made-up id never becomes an email
    const names = sent.extra_tools.map((x) => x.name)
    for (const n of ['search_candidates', 'get_candidate', 'list_feedback', 'list_drives', 'list_interviewers', 'list_emails', 'recent_activity', 'get_overview']) assert.ok(names.includes(n), n)
    assert.ok(sent.extra_tools.every((x) => x.url.startsWith('https://hirerelay.example.test/api/agent-tools/') && x.method === 'POST'))
    assert.equal(verifyToolToken(sent.extra_tools[0].headers.Authorization.replace('Bearer ', '')), t.users.a.id)  // token belongs to the asker
    assert.ok(sent.extra_tools.length <= 20)
    assert.doesNotMatch(sent.prompt, /live data snapshot/i); assert.match(sent.prompt, /Never mention/); assert.match(sent.message, /^give me the latest rejected candidate/)
    assert.equal(sent.response_type, 'json_schema')
    // Without a public address (local development) it still answers, from the summary alone.
    delete process.env.HIRERELAY_PUBLIC_URL; sent = null
    assert.equal((await t.a('POST', '/api/agent/message', { message: 'hi', thread_id: 'toolcheck' })).status, 200); assert.equal(sent.extra_tools, undefined)
  } finally { globalThis.fetch = realFetch; delete process.env.VIASOCKET_EMBED_SECRET; delete process.env.HIRERELAY_PUBLIC_URL }
})


// ---------- CV upload, secure links, interviewer briefing ----------
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n'), Buffer.alloc(200, 65), Buffer.from('\n%%EOF')])
const DOCX = Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.alloc(30, 0), Buffer.from('word/document.xml'), Buffer.alloc(100, 1)])
const DOC = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(200, 2)])
const register = (slug, fields, file) => {
  const fd = new FormData(); for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  if (file) fd.append('cv', new Blob([file.bytes]), file.name)
  return fetch(`${t.base}/api/public/drives/${slug}/register`, { method: 'POST', body: fd }).then(async (r) => ({ status: r.status, body: await r.json() }))
}
const download = (token, id) => fetch(`${t.base}/api/candidates/${id}/cv`, { headers: token ? { authorization: `Bearer ${token}` } : {} })
let tokA, tokB
const login = async (who, email) => (await t.anon('POST', '/api/auth/login', { email, password: 'correct-horse-9' })).body.token

test('file type detection trusts the bytes, not the name', async () => {
  const { detectType } = await import('../src/lib/files.js')
  assert.equal(detectType(PDF).ext, 'pdf'); assert.equal(detectType(DOCX).ext, 'docx'); assert.equal(detectType(DOC).ext, 'doc')
  assert.equal(detectType(Buffer.from('MZ\x90\x00 this is an exe renamed cv.pdf '.repeat(5))), null)
  assert.equal(detectType(Buffer.from('just some text, called cv.pdf'.repeat(5))), null)
  assert.equal(detectType(Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.alloc(80, 0)])), null) // a zip that is not a Word document
  assert.equal(detectType(Buffer.alloc(0)), null)
})

test('the registration form accepts a CV, rejects bad files without creating anyone, and keeps JSON working', async () => {
  tokA = await login('a', 'a@hr.test'); tokB = await login('b', 'b@hr.test')
  const ok = await register(drive.slug, { full_name: 'Cv Person', email: 'cvperson@example.com', phone: '9333333333' }, { bytes: PDF, name: '../../My CV (final).pdf' })
  assert.equal(ok.status, 201)
  const c = (await t.a('GET', '/api/candidates?q=cvperson')).body[0]
  assert.equal(c.has_cv, true)
  const detail = (await t.a('GET', `/api/candidates/${c.id}`)).body
  assert.deepEqual([detail.cv.mime, detail.cv.size], ['application/pdf', PDF.length]); assert.ok(!/[\\/]/.test(detail.cv.name) && detail.cv.name.endsWith('.pdf'), detail.cv.name) // path tricks stripped
  // wrong type / disguised file: refused, and nobody is created
  const bad = await register(drive.slug, { full_name: 'Bad File', email: 'badfile@example.com' }, { bytes: Buffer.from('MZ not a document at all '.repeat(10)), name: 'cv.pdf' })
  assert.equal(bad.status, 422); assert.match(bad.body.error, /PDF, DOC or DOCX/)
  assert.equal((await t.a('GET', '/api/candidates?q=badfile')).body.length, 0)
  // too large
  const big = await register(drive.slug, { full_name: 'Big File', email: 'bigfile@example.com' }, { bytes: Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024)]), name: 'cv.pdf' })
  assert.equal(big.status, 413); assert.equal((await t.a('GET', '/api/candidates?q=bigfile')).body.length, 0)
  // no file: still fine, in both encodings
  assert.equal((await register(drive.slug, { full_name: 'No Cv Multipart', email: 'nocvm@example.com' })).status, 201)
  assert.equal((await t.anon('POST', `/api/public/drives/${drive.slug}/register`, { full_name: 'No Cv Json', email: 'nocvj@example.com' })).status, 201)
  assert.equal((await t.a('GET', '/api/candidates?q=nocvm')).body[0].has_cv, false)
  // someone re-submitting with the same email cannot replace the CV that is already there
  await register(drive.slug, { full_name: 'Cv Person', email: 'cvperson@example.com' }, { bytes: DOCX, name: 'evil.docx' })
  assert.equal((await t.a('GET', `/api/candidates/${c.id}`)).body.cv.mime, 'application/pdf')
  // ...but a duplicate can supply a CV when none exists yet
  await register(drive.slug, { full_name: 'No Cv Multipart', email: 'nocvm@example.com' }, { bytes: DOC, name: 'late.doc' })
  assert.equal((await t.a('GET', '/api/candidates?q=nocvm')).body[0].has_cv, true)
})

test('HR can download, replace and remove a CV; nobody else can', async () => {
  const c = (await t.a('GET', '/api/candidates?q=cvperson')).body[0]
  assert.equal((await download(null, c.id)).status, 401)
  assert.equal((await download(tokB, c.id)).status, 404)                                   // another HR user
  const r = await download(tokA, c.id)
  assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'application/pdf')
  assert.match(r.headers.get('content-disposition'), /^attachment;/); assert.equal(r.headers.get('x-content-type-options'), 'nosniff')
  assert.ok(Buffer.from(await r.arrayBuffer()).equals(PDF))                                // bytes survive unchanged
  const put = (token, file) => { const fd = new FormData(); fd.append('cv', new Blob([file.bytes]), file.name); return fetch(`${t.base}/api/candidates/${c.id}/cv`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: fd }) }
  assert.equal((await put(tokB, { bytes: PDF, name: 'x.pdf' })).status, 404)
  assert.equal((await put(tokA, { bytes: Buffer.from('plain text'.repeat(10)), name: 'x.pdf' })).status, 422)
  assert.equal((await put(tokA, { bytes: DOCX, name: 'new.docx' })).status, 201)           // replaces the old one
  const after = await download(tokA, c.id); assert.match(after.headers.get('content-type'), /wordprocessingml/)
  assert.equal((await t.b('DELETE', `/api/candidates/${c.id}/cv`)).status, 404)
  assert.equal((await t.a('DELETE', `/api/candidates/${c.id}/cv`)).status, 200)
  assert.equal((await download(tokA, c.id)).status, 404)
  assert.equal((await t.a('GET', `/api/candidates/${c.id}`)).body.cv, null)
})

test('deleting a candidate deletes their CV bytes from disk', async () => {
  const fs = await import('node:fs'); const path = await import('node:path')
  const { query } = await import('../src/db.js'); const { config } = await import('../src/config.js')
  await register(drive.slug, { full_name: 'Disk Cleanup', email: 'diskclean@example.com' }, { bytes: PDF, name: 'cv.pdf' })
  const c = (await t.a('GET', '/api/candidates?q=diskclean')).body[0]
  const row = (await query('select storage_name from candidate_files where candidate_id = $1', [c.id])).rows[0]
  const file = path.join(config.dataDir, 'cvs', row.storage_name)
  assert.ok(fs.existsSync(file))
  await t.a('DELETE', `/api/candidates/${c.id}`)
  assert.ok(!fs.existsSync(file)); assert.equal((await query('select 1 from candidate_files where candidate_id = $1', [c.id])).rows.length, 0)
})

test('signed CV links: valid ones serve the file, forged, expired or unknown ones do not', async () => {
  const { query } = await import('../src/db.js'); const { cvLinkPath } = await import('../src/lib/files.js'); const { config } = await import('../src/config.js')
  await register(drive.slug, { full_name: 'Link Person', email: 'linkperson@example.com' }, { bytes: PDF, name: 'link cv.pdf' })
  const c = (await t.a('GET', '/api/candidates?q=linkperson')).body[0]
  const f = (await query('select * from candidate_files where candidate_id = $1', [c.id])).rows[0]
  const get = (p) => fetch(`${t.base}${p}`)
  const ok = await get(cvLinkPath(f)); assert.equal(ok.status, 200); assert.ok(Buffer.from(await ok.arrayBuffer()).equals(PDF))
  assert.match(ok.headers.get('content-disposition'), /link cv\.pdf/)
  const path = cvLinkPath(f); const parts = path.split('/')
  const tampered = path.replace(/\.[A-Za-z0-9_-]+\//, (m) => m.slice(0, -2) + (m.at(-2) === 'a' ? 'b' : 'a') + '/')
  assert.equal((await get(tampered)).status, 403)                                            // forged signature
  const [id, exp, sig] = parts[4].split('.')
  assert.equal((await get(`/api/files/cv/${id}.${Number(exp) + 99999}.${sig}/x`)).status, 403) // lengthened expiry breaks the signature
  assert.equal((await get(cvLinkPath(f, -10))).status, 410)                                  // properly signed but expired
  assert.equal((await get('/api/files/cv/nonsense/x')).status, 403)
  assert.equal((await get(cvLinkPath({ ...f, id: crypto.randomUUID() }))).status, 404)       // signed for a file that does not exist
})

test('assigning an interviewer briefs them with the details, the form answers and the CV attached', async () => {
  const { query } = await import('../src/db.js')
  const realFetch = globalThis.fetch; const gmail = []
  await query(`insert into viasocket_connections (owner_id, service_id, auth_id, script_id, config) values ($1,'rowo0bqrhj5g','auth_rowo0bqrhj5g','scriBRIEF',$2)`, [t.users.a.id, { from: 'me@example.com' }])
  process.env.HIRERELAY_PUBLIC_URL = 'https://hirerelay.example.test'
  globalThis.fetch = async (url, init) => String(url).includes('/func/scriBRIEF') ? (gmail.push(JSON.parse(init.body).inputData), new Response(JSON.stringify({ success: true, data: { id: `m${gmail.length}`, labelIds: ['SENT'] } }), { status: 200 })) : realFetch(url, init)
  const settle = async (n) => { for (let i = 0; i < 40 && gmail.length < n; i++) await new Promise((r) => setTimeout(r, 100)) }
  try {
    const iv = (await t.a('POST', '/api/interviewers', { name: 'Brief Panelist', email: 'brief@hr.test' })).body
    const noEmailIv = (await t.a('POST', '/api/interviewers', { name: 'Silent Panelist' })).body
    // a candidate with a CV and a hostile form answer
    await t.anon('POST', '/api/ingest/google-forms', { drive_id: drive.id, event: { responseId: 'brief-1', Full_Name: 'Brief Me', Email: 'briefme@example.com', Phone_No_: '9444444444', College: '<script>alert(1)</script> IIT' } }, { 'x-hirerelay-ingest-key': ingestKeyFor(drive.id) })
    const c = (await t.a('GET', '/api/candidates?q=briefme')).body[0]
    await t.a('POST', `/api/candidates/${c.id}/cv`) // no body: rejected, nothing stored
    const fd = new FormData(); fd.append('cv', new Blob([PDF]), 'Brief Me CV.pdf')
    assert.equal((await realFetch(`${t.base}/api/candidates/${c.id}/cv`, { method: 'POST', headers: { authorization: `Bearer ${tokA}` }, body: fd })).status, 201)

    await t.a('PATCH', `/api/candidates/${c.id}/interviewer`, { interviewer_id: iv.id })
    await settle(2)                                                                          // candidate email + interviewer briefing, both auto-sent
    const toIv = gmail.find((g) => g.to === 'brief@hr.test'); const toCand = gmail.find((g) => g.to === 'briefme@example.com')
    assert.ok(toIv && toCand, JSON.stringify(gmail.map((g) => g.to)))
    assert.match(toIv.subject, /New candidate for you: Brief Me/)
    for (const needle of ['Brief Me', 'briefme@example.com', '9444444444', 'Brief Panelist', 'College']) assert.ok(toIv.messageBody.includes(needle), needle)
    assert.ok(!toIv.messageBody.includes('<script>') && toIv.messageBody.includes('&lt;script&gt;'))   // form answers are escaped
    assert.ok(!toCand.attachments, 'the candidate does not get their own CV back')
    // the attachment link works for the email service, and returns exactly the uploaded CV
    assert.match(toIv.attachments, /^https:\/\/hirerelay\.example\.test\/api\/files\/cv\/[^,]+\/Brief%20Me%20CV\.pdf$/)
    const fetched = await realFetch(t.base + new URL(toIv.attachments).pathname); assert.equal(fetched.status, 200); assert.ok(Buffer.from(await fetched.arrayBuffer()).equals(PDF))
    // an interviewer with no email address: nobody to brief, and a candidate without a CV is briefed without one
    const before = gmail.length
    await t.a('PATCH', `/api/candidates/${c.id}/interviewer`, { interviewer_id: noEmailIv.id }); await new Promise((r) => setTimeout(r, 300))
    assert.deepEqual(gmail.slice(before).map((g) => g.to), ['briefme@example.com'])           // only the "interviewer changed" note to the candidate
    const plain = (await t.a('POST', '/api/candidates', { drive_id: drive.id, full_name: 'Plain Brief', email: 'plainbrief@example.com' })).body
    await t.a('PATCH', `/api/candidates/${plain.id}/interviewer`, { interviewer_id: iv.id }); await settle(before + 3)
    const plainMail = gmail.find((g) => g.to === 'brief@hr.test' && /Plain Brief/.test(g.subject))
    assert.ok(plainMail && !plainMail.attachments && /did not upload a CV/.test(plainMail.messageBody))
    // switch off: the briefing waits for approval, with the CV still attached once approved
    await t.a('PUT', '/api/settings', { auto_send_interviewer_briefing: false })
    const held = (await t.a('POST', '/api/candidates', { drive_id: drive.id, full_name: 'Held Brief', email: 'heldbrief@example.com' })).body
    const fd2 = new FormData(); fd2.append('cv', new Blob([DOCX]), 'held.docx'); await realFetch(`${t.base}/api/candidates/${held.id}/cv`, { method: 'POST', headers: { authorization: `Bearer ${tokA}` }, body: fd2 })
    const n = gmail.length; await t.a('PATCH', `/api/candidates/${held.id}/interviewer`, { interviewer_id: iv.id }); await settle(n + 1)
    const pending = (await t.a('GET', '/api/approvals?status=pending')).body.find((a) => a.payload.to === 'brief@hr.test' && /Held Brief/.test(a.title))
    assert.ok(pending && pending.payload.attachments[0].name === 'held.docx')
    const sent = await t.a('POST', `/api/approvals/${pending.id}/approve`); assert.equal(sent.body.status, 'executed')
    assert.match(gmail.at(-1).attachments, /held\.docx$/)
    // no public address: the send fails clearly rather than dropping the CV silently
    delete process.env.HIRERELAY_PUBLIC_URL
    const lost = (await t.a('POST', '/api/candidates', { drive_id: drive.id, full_name: 'No Public Url', email: 'nopub@example.com' })).body
    const fd3 = new FormData(); fd3.append('cv', new Blob([PDF]), 'p.pdf'); await realFetch(`${t.base}/api/candidates/${lost.id}/cv`, { method: 'POST', headers: { authorization: `Bearer ${tokA}` }, body: fd3 })
    await t.a('PATCH', `/api/candidates/${lost.id}/interviewer`, { interviewer_id: iv.id })
    const stuck = (await t.a('GET', '/api/approvals?status=pending')).body.find((a) => /No Public Url/.test(a.title) && a.payload.to === 'brief@hr.test')
    const failed = await t.a('POST', `/api/approvals/${stuck.id}/approve`); assert.equal(failed.body.status, 'failed'); assert.match(failed.body.error, /HIRERELAY_PUBLIC_URL/)
  } finally { globalThis.fetch = realFetch; delete process.env.HIRERELAY_PUBLIC_URL; await t.a('PUT', '/api/settings', { auto_send_interviewer_briefing: true }); await query('delete from viasocket_connections') }
})

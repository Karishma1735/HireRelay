import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { start } from './helpers.js'

let t
before(async () => { t = await start() })
after(() => t.stop())

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let n = 0
const mkDrive = async (name, rounds) => (await t.a('POST', '/api/drives', { name, ...(rounds ? { rounds } : {}) })).body
const mkIv = async (name, extra = {}) => { const iv = (await t.a('POST', '/api/interviewers', { name, email: `${name.replace(/\s/g, '').toLowerCase()}@hr.test` })).body; return Object.keys(extra).length ? (await t.a('PATCH', `/api/interviewers/${iv.id}`, extra)).body : iv }
const mkCand = async (drive, name = `Cand ${++n}`) => (await t.a('POST', '/api/candidates', { drive_id: drive.id, full_name: name, email: `c${++n}@example.com` })).body
const stage = (c, s, iv) => t.a('POST', `/api/candidates/${c.id}/stage`, { stage: s, ...(iv ? { interviewer_id: iv.id } : {}) })
const get = async (c) => (await t.a('GET', `/api/candidates/${c.id}`)).body
const queue = async (c) => { await stage(c, 'checked_in'); await sleep(4); return get(c) }           // auto-queue is on: check-in puts them waiting
const interview = async (c, iv) => { await t.a('PATCH', `/api/candidates/${c.id}/interviewer`, { interviewer_id: iv.id }); await stage(c, 'in_interview'); return stage(c, 'completed') }

// ---------- multi-round hiring ----------
test('a drive keeps its rounds; fewer than two is a single round; bad lists are refused', async () => {
  const d = await mkDrive('Rounds Drive', ['Technical', 'HR', 'Manager'])
  assert.deepEqual(d.rounds, ['Technical', 'HR', 'Manager'])
  assert.deepEqual((await mkDrive('Plain Drive')).rounds, [])
  assert.deepEqual((await mkDrive('One Round Drive', ['Only'])).rounds, [])
  assert.equal((await t.a('POST', '/api/drives', { name: 'Too Many', rounds: ['a1', 'b2', 'c3', 'd4', 'e5', 'f6', 'g7'] })).status, 400)
  assert.equal((await t.a('POST', '/api/drives', { name: 'Short Names', rounds: ['x', 'y'] })).status, 400)
  const patched = (await t.a('PATCH', `/api/drives/${d.id}`, { rounds: ['Screen', 'Final'] })).body
  assert.deepEqual(patched.rounds, ['Screen', 'Final'])
  assert.deepEqual((await t.a('GET', `/api/drives/${d.id}`)).body.rounds, ['Screen', 'Final'])
})

test('a candidate moves through every round, each with its own interviewer and feedback, and is selected only in the last', async () => {
  const d = await mkDrive('Ladder Drive', ['Technical', 'HR', 'Manager'])
  const [tech, hr, boss] = [await mkIv('Tech Person'), await mkIv('HR Person'), await mkIv('Boss Person')]
  const c = await queue(await mkCand(d, 'Rounds Candidate'))
  assert.deepEqual([c.round, c.round_name, c.rounds_total, c.final_round, c.next_round_name], [1, 'Technical', 3, false, 'HR'])
  const queueNo = c.queue_number

  await interview(c, tech)
  // Round 1 is not the last: selecting is refused, and so is advancing before feedback is recorded.
  const early = await stage(c, 'selected'); assert.equal(early.status, 409); assert.match(early.body.error, /Advance them to HR/)
  const noFb = await t.a('POST', `/api/candidates/${c.id}/advance`); assert.equal(noFb.status, 409); assert.match(noFb.body.error, /Technical feedback/)
  assert.equal((await t.a('POST', `/api/candidates/${c.id}/feedback`, { rating: 4, recommendation: 'hire', notes: 'Strong coder' })).status, 201)

  const adv = await t.a('POST', `/api/candidates/${c.id}/advance`, { interviewer_id: hr.id })
  assert.equal(adv.status, 200)
  let now = await get(c)
  assert.deepEqual([now.round, now.round_name, now.stage, now.interviewer_id, now.queue_number], [2, 'HR', 'waiting', hr.id, queueNo])
  assert.equal(now.interview_started_at, null); assert.equal(now.interview_completed_at, null)
  assert.equal(now.feedback, null)                                         // the finished round's feedback is not "due" for the new round
  assert.equal(now.feedbacks.length, 1); assert.deepEqual([now.feedbacks[0].round, now.feedbacks[0].round_name, now.feedbacks[0].interviewer_name], [1, 'Technical', 'Tech Person'])
  assert.equal((await t.a('GET', '/api/dashboard')).body.metrics.pending_feedback, 0)

  // The candidate is told they are through, with the round name, and the new interviewer is briefed with what round 1 said.
  const { query } = await import('../src/db.js')
  const mails = (await query(`select * from approvals where candidate_id = $1 order by created_at`, [c.id])).rows
  const next = mails.find((m) => /^Next round: HR/.test(m.payload.subject)); assert.ok(next, mails.map((m) => m.payload.subject).join(' | '))
  assert.match(next.payload.body, /Round 2 of 3/)
  const brief = mails.find((m) => m.payload.to === 'hrperson@hr.test'); assert.ok(brief)
  assert.match(brief.payload.body, /2 of 3: HR/); assert.match(brief.payload.body, /What earlier rounds said/); assert.match(brief.payload.body, /Strong coder/)

  // Round 2 takes its own feedback (the old one-per-candidate rule would have refused this).
  await stage(c, 'in_interview'); await stage(c, 'completed')
  assert.equal((await t.a('POST', `/api/candidates/${c.id}/feedback`, { rating: 5, recommendation: 'hire' })).status, 201)
  assert.equal((await t.a('POST', `/api/candidates/${c.id}/feedback`, { rating: 5, recommendation: 'hire' })).status, 409) // still once per round
  await t.a('POST', `/api/candidates/${c.id}/advance`, { interviewer_id: boss.id })

  // Last round: no advancing, selecting works.
  await stage(c, 'in_interview'); await stage(c, 'completed')
  await t.a('POST', `/api/candidates/${c.id}/feedback`, { rating: 5, recommendation: 'hire' })
  now = await get(c); assert.deepEqual([now.round, now.round_name, now.final_round, now.feedbacks.length], [3, 'Manager', true, 3])
  const last = await t.a('POST', `/api/candidates/${c.id}/advance`); assert.equal(last.status, 409); assert.match(last.body.error, /last round/)
  assert.equal((await stage(c, 'selected')).status, 200)
  assert.equal((await get(c)).stage, 'selected')
})

test('rounds: reject works in any round, advance needs a completed interview, a one-round drive behaves as before, and owners are separate', async () => {
  const d = await mkDrive('Reject Drive', ['Technical', 'HR'])
  const iv = await mkIv('Reject Person')
  const c = await queue(await mkCand(d))
  assert.equal((await t.a('POST', `/api/candidates/${c.id}/advance`)).status, 409)               // still waiting
  await interview(c, iv); await t.a('POST', `/api/candidates/${c.id}/feedback`, { rating: 1, recommendation: 'reject' })
  assert.equal((await t.b('POST', `/api/candidates/${c.id}/advance`)).status, 404)               // someone else's candidate
  assert.equal((await stage(c, 'rejected')).status, 200)
  assert.equal((await t.a('POST', `/api/candidates/${c.id}/advance`)).status, 409)               // rejected, not completed

  const plain = await mkDrive('Single Round Drive'); const p = await queue(await mkCand(plain))
  assert.deepEqual([p.round_name, p.rounds_total, p.final_round], ['Interview', 1, true])
  await interview(p, iv); await t.a('POST', `/api/candidates/${p.id}/feedback`, { rating: 4, recommendation: 'hire' })
  assert.equal((await t.a('POST', `/api/candidates/${p.id}/advance`)).status, 409)
  assert.equal((await stage(p, 'selected')).status, 200)
})

test('rounds: shortening the list never strands a candidate, and the agent sees every round of feedback', async () => {
  const d = await mkDrive('Shrink Drive', ['Technical', 'HR', 'Manager']); const iv = await mkIv('Shrink Person')
  const c = await queue(await mkCand(d, 'Shrink Candidate')); await interview(c, iv)
  await t.a('POST', `/api/candidates/${c.id}/feedback`, { rating: 3, recommendation: 'hire' }); await t.a('POST', `/api/candidates/${c.id}/advance`)
  await t.a('PATCH', `/api/drives/${d.id}`, { rounds: [] })                                   // back to a single round
  const now = await get(c); assert.deepEqual([now.round, now.round_name, now.rounds_total, now.final_round], [2, 'Interview', 1, true])
  await stage(c, 'in_interview', iv); await stage(c, 'completed')
  assert.equal((await stage(c, 'selected')).status, 200)
  const { toolDefinitions } = await import('../src/lib/agentTools.js'); assert.ok(toolDefinitions)
})

// ---------- interviewer availability and capacity ----------
test('availability: an interviewer on a break, gone for the day or inactive is refused unless HR confirms', async () => {
  const d = await mkDrive('Availability Drive'); const iv = await mkIv('Break Person'); const c = await mkCand(d)
  const assign = (body) => t.a('PATCH', `/api/candidates/${c.id}/interviewer`, { interviewer_id: iv.id, ...body })

  assert.equal((await t.a('PATCH', `/api/interviewers/${iv.id}`, { availability: 'on_break' })).body.availability_state, 'on_break')
  const refused = await assign(); assert.equal(refused.status, 409); assert.equal(refused.body.code, 'on_break'); assert.match(refused.body.error, /Break Person is on a break/)
  assert.equal((await get(c)).interviewer_id, null)
  assert.equal((await assign({ force: true })).status, 200)                                   // HR knows best
  assert.equal((await get(c)).interviewer_id, iv.id)

  await t.a('PATCH', `/api/candidates/${c.id}/interviewer`, { interviewer_id: null })
  assert.equal((await t.a('PATCH', `/api/interviewers/${iv.id}`, { availability: 'available' })).body.available_now, true)
  assert.equal((await assign()).status, 200)

  // "leaving at": a time in the past means left, in the future still available, null clears it
  await t.a('PATCH', `/api/candidates/${c.id}/interviewer`, { interviewer_id: null })
  const left = (await t.a('PATCH', `/api/interviewers/${iv.id}`, { available_until: new Date(Date.now() - 60000).toISOString() })).body
  assert.deepEqual([left.availability_state, left.available_now], ['left', false])
  assert.equal((await assign()).body.code, 'left')
  const soon = (await t.a('PATCH', `/api/interviewers/${iv.id}`, { available_until: new Date(Date.now() + 3600000).toISOString() })).body
  assert.equal(soon.availability_state, 'available'); assert.equal((await assign()).status, 200)
  await t.a('PATCH', `/api/candidates/${c.id}/interviewer`, { interviewer_id: null })
  const cleared = (await t.a('PATCH', `/api/interviewers/${iv.id}`, { available_until: null })).body; assert.equal(cleared.available_until, null)
  // an unrelated edit leaves availability alone
  await t.a('PATCH', `/api/interviewers/${iv.id}`, { availability: 'on_break', available_until: new Date(Date.now() + 3600000).toISOString() })
  const renamed = (await t.a('PATCH', `/api/interviewers/${iv.id}`, { name: 'Break Person Renamed' })).body
  assert.deepEqual([renamed.availability, renamed.available_until != null], ['on_break', true])
  // inactive interviewers are refused too; bad input is refused
  await t.a('PATCH', `/api/interviewers/${iv.id}`, { active: false, availability: 'available' }); assert.equal((await assign()).body.code, 'inactive')
  assert.equal((await t.a('PATCH', `/api/interviewers/${iv.id}`, { availability: 'asleep' })).status, 400)
  assert.equal((await t.a('PATCH', `/api/interviewers/${iv.id}`, { available_until: 'soon' })).status, 400)
  assert.equal((await t.b('PATCH', `/api/interviewers/${iv.id}`, { availability: 'on_break' })).status, 404)
})

test('capacity: an interviewer is full at their limit in that drive, counting the rounds they already did', async () => {
  const d = await mkDrive('Capacity Drive', ['Technical', 'HR']); const other = await mkDrive('Other Capacity Drive')
  const iv = await mkIv('Capped Person', { capacity: 2 })
  assert.equal(iv.capacity, 2)
  const [c1, c2, c3] = [await mkCand(d), await mkCand(d), await mkCand(d)]
  const put = (c, body = {}) => t.a('PATCH', `/api/candidates/${c.id}/interviewer`, { interviewer_id: iv.id, ...body })
  assert.equal((await put(c1)).status, 200); assert.equal((await put(c2)).status, 200)
  assert.equal((await put(c1)).status, 200)                                                   // re-saving the same assignment is never "full"
  const full = await put(c3); assert.equal(full.status, 409); assert.equal(full.body.code, 'full'); assert.match(full.body.error, /2 of 2/)
  assert.equal((await put(await mkCand(other))).status, 200)                                  // the limit is per drive
  await stage(c2, 'no_show')                                                                  // a no-show frees the place
  assert.equal((await put(c3)).status, 200)
  assert.equal((await put(await mkCand(d))).body.code, 'full')                                // c1 + c3 again
  // a candidate the interviewer finished and advanced still counts toward the interviewer's drive total
  await t.a('PATCH', `/api/candidates/${c1.id}/interviewer`, { interviewer_id: iv.id }); await stage(c1, 'checked_in'); await stage(c1, 'in_interview'); await stage(c1, 'completed')
  await t.a('POST', `/api/candidates/${c1.id}/feedback`, { rating: 4, recommendation: 'hire' }); await t.a('POST', `/api/candidates/${c1.id}/advance`)
  assert.equal((await get(c1)).interviewer_id, null)
  assert.equal((await put(await mkCand(d))).body.code, 'full')                                // c1 (done) + c3
  assert.equal((await put(await mkCand(d), { force: true })).status, 200)                      // HR override
  // removing the limit
  assert.equal((await t.a('PATCH', `/api/interviewers/${iv.id}`, { capacity: null })).body.capacity, null)
  assert.equal((await put(await mkCand(d))).status, 200)
  assert.equal((await t.a('PATCH', `/api/interviewers/${iv.id}`, { capacity: 0 })).status, 400)
})

test('advance: choosing a next-round interviewer respects availability, and force overrides', async () => {
  const d = await mkDrive('Advance Check Drive', ['Technical', 'HR']); const [a, b] = [await mkIv('Round One Person'), await mkIv('Away Person', { availability: 'on_break' })]
  const c = await queue(await mkCand(d)); await interview(c, a); await t.a('POST', `/api/candidates/${c.id}/feedback`, { rating: 4, recommendation: 'hire' })
  const refused = await t.a('POST', `/api/candidates/${c.id}/advance`, { interviewer_id: b.id }); assert.equal(refused.status, 409); assert.equal(refused.body.code, 'on_break')
  assert.equal((await get(c)).round, 1)                                                         // nothing changed
  assert.equal((await t.a('POST', `/api/candidates/${c.id}/advance`, { interviewer_id: b.id, force: true })).status, 200)
  assert.deepEqual([(await get(c)).round, (await get(c)).interviewer_id], [2, b.id])
})

test('suggestions: the longest waiter goes to a free, available interviewer under their limit, once each', async () => {
  // Interviewers are shared across the account: switch off everyone from the other tests so only this test's people are candidates for a suggestion.
  for (const old of (await t.a('GET', '/api/interviewers')).body) await t.a('PATCH', `/api/interviewers/${old.id}`, { active: false })
  const d = await mkDrive('Suggest Drive'); const [free, away, busy, capped] = [await mkIv('Free Person'), await mkIv('Away Two', { availability: 'on_break' }), await mkIv('Busy Person'), await mkIv('Capped Two', { capacity: 1 })]
  const [first, second, third, fourth] = [await queue(await mkCand(d, 'First Waiter')), await queue(await mkCand(d, 'Second Waiter')), await queue(await mkCand(d, 'Third Waiter')), await queue(await mkCand(d, 'Fourth Waiter'))]
  const sug = async () => (await t.a('GET', `/api/dashboard?drive_id=${d.id}`)).body.suggestions
  // busy has a candidate in an interview right now
  const inRoom = await queue(await mkCand(d, 'In Room')); await t.a('PATCH', `/api/candidates/${inRoom.id}/interviewer`, { interviewer_id: busy.id }); await stage(inRoom, 'in_interview')
  await t.a('PATCH', `/api/candidates/${fourth.id}/interviewer`, { interviewer_id: capped.id })   // capped now holds Fourth (1 of 1), their limit

  let s = await sug()
  const names = s.map((x) => `${x.interviewer.name}->${x.candidate.full_name}`)
  assert.ok(names.includes('Free Person->First Waiter'), names.join(', '))                       // longest wait
  assert.ok(names.includes('Capped Two->Fourth Waiter'), names.join(', '))                      // their own assigned candidate comes first
  assert.ok(!names.some((x) => x.startsWith('Away Two') || x.startsWith('Busy Person')), names.join(', '))
  assert.equal(new Set(s.map((x) => x.candidate.id)).size, s.length)                              // nobody is suggested twice
  assert.equal(s.find((x) => x.interviewer.name === 'Free Person').candidate.round_name, 'Interview')

  await t.a('PATCH', `/api/interviewers/${free.id}`, { availability: 'on_break' })                // free goes on a break: no suggestion for them
  s = await sug(); assert.ok(!s.some((x) => x.interviewer.name === 'Free Person'))
  await t.a('PATCH', `/api/interviewers/${away.id}`, { availability: 'available' })
  s = await sug(); assert.ok(s.some((x) => x.interviewer.name === 'Away Two' && x.candidate.full_name === 'First Waiter'), JSON.stringify(s.map((x) => [x.interviewer.name, x.candidate.full_name])))
  assert.ok(first && second && third)
})

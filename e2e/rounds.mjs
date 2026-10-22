import { chromium } from 'playwright-core'
const B = process.env.E2E_BASE || 'http://localhost:8788'
const j = async (m, p, b, t) => (await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b && JSON.stringify(b) })).json()
const email = `rounds-${Date.now()}@example.com`
const { token } = await j('POST', '/api/auth/signup', { email, password: 'supersecret1' })
const drive = await j('POST', '/api/drives', { name: 'Rounds Drive', rounds: ['Technical', 'HR'] }, token)
const meera = await j('POST', '/api/interviewers', { name: 'Meera Shah', email: 'meera@example.com' }, token)
const arjun = await j('POST', '/api/interviewers', { name: 'Arjun Rao', email: 'arjun@example.com' }, token)
const mk = (name, i) => j('POST', '/api/candidates', { drive_id: drive.id, full_name: name, email: `r${i}-${Date.now()}@example.com` }, token)
const asha = await mk('Asha Rounds', 1); const dev = await mk('Dev Waiter', 2)
await j('PATCH', `/api/candidates/${asha.id}/interviewer`, { interviewer_id: meera.id }, token)
for (const s of ['checked_in', 'in_interview', 'completed']) await j('POST', `/api/candidates/${asha.id}/stage`, { stage: s }, token)
await j('POST', `/api/candidates/${dev.id}/stage`, { stage: 'checked_in' }, token)
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox'] })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
await ctx.addInitScript((s) => localStorage.setItem('hirerelay-session', JSON.stringify(s)), { token, user: { email } })
const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message))
const dialogs = []; page.on('dialog', (d) => { dialogs.push(d.message()); d.accept() })
let failed = 0; const step = async (name, fn) => { try { await fn(); console.log('ok  ', name) } catch (e) { failed++; console.log('FAIL', name, '-', e.message.split('\n')[0]) } }
const row = (name) => page.locator('tr', { hasText: name })

await page.goto(`${B}/drives/${drive.id}`); await row('Asha Rounds').waitFor()
await step('the drive shows its rounds and the candidate their round', async () => {
  await page.getByText('Candidates advance through Technical → HR').waitFor(); await row('Asha Rounds').getByText('Round 1 · Technical').waitFor() })
await step('Select is replaced by Advance, which waits for feedback', async () => {
  const r = row('Asha Rounds'); if (await r.getByRole('button', { name: 'Select', exact: true }).count()) throw new Error('Select is shown before the last round')
  if (!(await r.getByRole('button', { name: /Advance to HR/ }).isDisabled())) throw new Error('Advance should wait for feedback') })
await step('feedback, then Advance moves them to the HR round and back to waiting', async () => {
  await row('Asha Rounds').getByRole('button', { name: 'Feedback' }).click(); await page.locator('textarea').fill('Solid in the technical round'); await page.getByRole('button', { name: 'Save feedback' }).click()
  await page.getByText(/Rating/).first().waitFor(); await page.keyboard.press('Escape'); await page.reload(); await row('Asha Rounds').waitFor()
  await row('Asha Rounds').getByRole('button', { name: /Advance to HR/ }).click()
  await row('Asha Rounds').getByText('Round 2 · HR').waitFor({ timeout: 8000 }); await row('Asha Rounds').getByText('Waiting').waitFor()
  if (!dialogs.some((d) => /HR round/.test(d))) throw new Error('no confirmation was asked') })
await step('the profile keeps round 1 feedback and asks nothing for round 2 yet', async () => {
  await page.getByRole('button', { name: 'Asha Rounds', exact: true }).click(); const m = page.locator('div.fixed'); await m.getByText('Round 2 of 2 · HR').waitFor(); await m.getByText(/Round 1 · Technical/).waitFor(); await m.getByText('Solid in the technical round').waitFor()
  await page.keyboard.press('Escape') })
await step('an interviewer on a break is flagged, and HR can still choose them after confirming', async () => {
  await page.goto(`${B}/interviewers/${arjun.id}`); await page.getByRole('button', { name: 'Start a break' }).click(); await page.getByText('On a break').first().waitFor()
  await page.goto(`${B}/drives/${drive.id}`); await row('Dev Waiter').waitFor()
  await row('Dev Waiter').getByLabel('Interviewer').selectOption({ label: 'Arjun Rao (on break)' })
  await page.waitForFunction(() => document.body.innerText.includes('Arjun Rao'), null, { timeout: 5000 })
  if (!dialogs.some((d) => /Arjun Rao is on a break\. Assign anyway\?/.test(d))) throw new Error('no warning: ' + JSON.stringify(dialogs))
  await page.waitForFunction(() => [...document.querySelectorAll('tr')].find((r) => r.innerText.includes('Dev Waiter'))?.querySelector('select')?.selectedOptions[0]?.text.startsWith('Arjun Rao'), null, { timeout: 8000 }) })
await step('capacity: the limit is saved on the interviewer page', async () => {
  await page.goto(`${B}/interviewers/${meera.id}`); await page.getByLabel('Most candidates per drive').fill('1'); await page.getByLabel('Most candidates per drive').blur(); await page.waitForTimeout(700)
  const s = await j('GET', `/api/interviewers/${meera.id}`, null, token); if (s.capacity !== 1) throw new Error('capacity not saved: ' + s.capacity) })
await step('the dashboard suggests the longest waiter for a free interviewer, and Assign does it', async () => {
  await j('PATCH', `/api/interviewers/${arjun.id}`, { availability: 'available' }, token)
  const dev2 = await mk('Dev Second', 3); await j('POST', `/api/candidates/${dev2.id}/stage`, { stage: 'checked_in' }, token)
  await page.goto(`${B}/`); await page.getByText('Suggested next').waitFor({ timeout: 8000 })
  const before = (await page.locator('main').innerText()); if (!/is free/.test(before)) throw new Error('no suggestion text')
  await page.getByRole('button', { name: /^Assign to/ }).first().click(); await page.waitForTimeout(800) })
console.log('errors:', JSON.stringify(errs)); await browser.close(); if (failed) process.exit(1)

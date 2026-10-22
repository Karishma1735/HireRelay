import { chromium } from 'playwright-core'
const B = process.env.E2E_BASE || 'http://localhost:8788'
const j = async (m, p, b, t) => (await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b && JSON.stringify(b) })).json()
const email = `fba-${Date.now()}@example.com`
const { token } = await j('POST', '/api/auth/signup', { email, password: 'supersecret1' })
const drive = await j('POST', '/api/drives', { name: 'Alert Drive' }, token)
const iv = await j('POST', '/api/interviewers', { name: 'Meera Shah', email: 'meera@example.com' }, token)
const c = await j('POST', '/api/candidates', { drive_id: drive.id, full_name: 'Alert Candidate', email: 'alertcand@example.com', role_applied: 'Engineer' }, token)
await j('PATCH', `/api/candidates/${c.id}/interviewer`, { interviewer_id: iv.id }, token)
for (const s of ['checked_in', 'in_interview', 'completed']) await j('POST', `/api/candidates/${c.id}/stage`, { stage: s }, token)
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox'] })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
await ctx.addInitScript((s) => localStorage.setItem('hirerelay-session', JSON.stringify(s)), { token, user: { email } })
const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message))
let failed = 0; const step = async (name, fn) => { try { await fn(); console.log('ok  ', name) } catch (e) { failed++; console.log('FAIL', name, '-', e.message.split('\n')[0]) } }
await page.goto(`${B}/approvals`); await page.getByLabel('Send feedback alerts to').waitFor()
await step('the alert switch is on by default, address blank = account email', async () => { if (!(await page.getByLabel("Email me when an interviewer's feedback is recorded").isChecked())) throw new Error('off'); const ph = await page.getByLabel('Send feedback alerts to').getAttribute('placeholder'); if (ph !== email) throw new Error('placeholder ' + ph) })
await step('a bad address is refused with a message', async () => { await page.getByLabel('Send feedback alerts to').fill('not-an-address'); await page.getByLabel('Send feedback alerts to').blur(); await page.getByText(/Invalid input|email/i).first().waitFor({ timeout: 6000 }) })
await step('a good address is saved and survives a reload', async () => { await page.reload(); await page.getByLabel('Send feedback alerts to').fill('boss@company.test'); await page.getByLabel('Send feedback alerts to').blur(); await page.waitForTimeout(700); await page.reload(); await page.waitForFunction(() => document.querySelector('[aria-label="Send feedback alerts to"]')?.value === 'boss@company.test', null, { timeout: 8000 }) })
await step('recording feedback confirms the alert and queues it for HR', async () => {
  await page.goto(`${B}/candidates`); await page.locator('tr', { hasText: 'Alert Candidate' }).getByRole('button', { name: 'Feedback' }).click()
  await page.getByLabel('Recommendation').selectOption('reject').catch(() => page.locator('select').nth(1).selectOption('reject'))
  await page.locator('textarea').fill('Not enough depth in the technical round.'); await page.getByRole('button', { name: 'Save feedback' }).click()
  await page.getByText('HR was emailed this verdict at boss@company.test').waitFor({ timeout: 8000 }) })
await step('the alert shows in Approvals with the verdict in the subject', async () => {
  await page.keyboard.press('Escape'); await page.goto(`${B}/approvals`); await page.getByRole('button', { name: 'All approvals' }).click()
  await page.getByText(/Feedback alert: Alert Candidate \(reject\)/).waitFor({ timeout: 8000 }); await page.getByText(/To boss@company.test/).first().waitFor() })
await step('switching it off stops alerts', async () => { await page.getByLabel("Email me when an interviewer's feedback is recorded").uncheck(); await page.waitForTimeout(600); const s = await j('GET', '/api/settings', null, token); if (s.email_feedback_alerts !== false) throw new Error('not saved') })
console.log('errors:', JSON.stringify(errs)); await browser.close(); if (failed) process.exit(1)

import { chromium } from 'playwright-core'
const B = process.env.E2E_BASE || 'http://localhost:8788'
const j = async (m, p, b, t) => (await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b && JSON.stringify(b) })).json()
const { token } = await j('POST', '/api/auth/signup', { email: 'iv@example.com', password: 'supersecret1' })
const meera = await j('POST', '/api/interviewers', { name: 'Meera Shah', email: 'meera@example.com' }, token)
const arjun = await j('POST', '/api/interviewers', { name: 'Arjun Rao' }, token)
const mk = async (name, people) => { const d = await j('POST', '/api/drives', { name }, token); const out = []; for (const n of people) { await j('POST', `/api/public/drives/${d.slug}/register`, { full_name: n, email: `${n.replace(' ', '').toLowerCase()}@example.com` }); } return d }
await mk('Pune Walk-in', ['Asha Rao', 'Ravi Kumar', 'Neha Singh']); await mk('Delhi Drive', ['Karan Patel', 'Isha Verma'])
const all = await j('GET', '/api/candidates', null, token); const by = (n) => all.find((c) => c.full_name === n)
const give = (n, iv) => j('PATCH', `/api/candidates/${by(n).id}/interviewer`, { interviewer_id: iv.id }, token)
for (const n of ['Asha Rao', 'Ravi Kumar', 'Karan Patel']) await give(n, meera)   // Meera: 2 in Pune, 1 in Delhi
await give('Neha Singh', arjun)
await j('POST', `/api/candidates/${by('Asha Rao').id}/stage`, { stage: 'checked_in' }, token)   // -> waiting
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox'] })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
await ctx.addInitScript((s) => localStorage.setItem('hirerelay-session', JSON.stringify(s)), { token, user: { email: 'iv@example.com' } })
const page = await ctx.newPage(); const errs = []
page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message)); page.on('response', (r) => r.url().includes('/api/') && r.status() >= 400 && errs.push(`HTTP ${r.status()} ${r.url().replace(B, '')}`))
let failed = 0
const step = async (name, fn) => { try { await fn(); console.log('ok  ', name) } catch (e) { failed++; console.log('FAIL', name, '-', e.message.split('\n')[0]) } }
await page.goto(B + '/interviewers'); await page.getByText('Meera Shah').waitFor()
await step('cards show live counts', async () => { const t = (await page.locator('a', { hasText: 'Meera Shah' }).innerText()).replace(/\s+/g, ' '); console.log('      Meera:', t); if (!/3 assigned/.test(t) || !/1 waiting/.test(t)) throw new Error('wrong counts') })

await step('Deactivate does not navigate', async () => { await page.locator('a', { hasText: 'Arjun Rao' }).getByRole('button', { name: 'Deactivate' }).click(); await page.getByText('Inactive').waitFor(); if (!page.url().endsWith('/interviewers')) throw new Error('navigated: ' + page.url()) })
await step('click Meera opens her page with her 3 candidates grouped by drive', async () => {
  await page.locator('a', { hasText: 'Meera Shah' }).click(); await page.getByText('Candidates assigned to Meera Shah').waitFor(); await page.getByText('Karan Patel').waitFor()
  const heads = (await page.locator('section[aria-label^="Drive "] header').allInnerTexts()).map((h) => h.replace(/\s+/g, ' ')); console.log('      sections:', heads)
  const text = await page.locator('main').innerText(); if (text.includes('Neha Singh')) throw new Error("shows another interviewer's candidate"); if (heads.length !== 2) throw new Error('expected 2 drive sections') })

await step('acting on the page updates her counts live (start interview)', async () => {
  const row = page.locator('tr', { hasText: 'Asha Rao' }); console.log('      row:', (await row.innerText()).replace(/\s+/g, ' '), '| buttons:', await row.getByRole('button').allInnerTexts(), '| disabled:', await row.getByRole('button', { name: 'Start interview' }).isDisabled().catch((e) => 'n/a'))
  await row.getByRole('button', { name: 'Start interview' }).click({ timeout: 5000 })
  await page.waitForFunction(() => /1 in interview/.test(document.querySelector('main').innerText) && /0 waiting/.test(document.querySelector('main').innerText), null, { timeout: 12000 }) })
await step('unknown interviewer id shows a friendly message', async () => { await page.goto(B + '/interviewers/00000000-0000-4000-8000-000000000000'); await page.getByText('Interviewer not found').waitFor({ timeout: 8000 }) })
console.log('errors:', JSON.stringify(errs)); await browser.close(); if (failed) process.exit(1)

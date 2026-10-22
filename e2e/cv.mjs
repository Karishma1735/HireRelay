import { chromium } from 'playwright-core'
const B = process.env.E2E_BASE || 'http://localhost:8788'
const j = async (m, p, b, t) => (await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b && JSON.stringify(b) })).json()
const pdf = (n) => Buffer.concat([Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n'), Buffer.alloc(300, 65 + n), Buffer.from('\n%%EOF')])
const { token } = await j('POST', '/api/auth/signup', { email: `cv-${Date.now()}@example.com`, password: 'supersecret1' })
const drive = await j('POST', '/api/drives', { name: 'CV Drive', role_title: 'Engineer', venue: 'Hall B' }, token)
await j('POST', '/api/interviewers', { name: 'Meera Shah', email: 'meera@example.com' }, token)
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox'] })
let failed = 0
const step = async (name, fn) => { try { await fn(); console.log('ok  ', name) } catch (e) { failed++; console.log('FAIL', name, '-', e.message.split('\n')[0]) } }

// 1. a candidate registers with a CV on the public form
const pub = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage()
await pub.goto(`${B}/apply/${drive.slug}`); await pub.getByLabel('Full name *').waitFor()
await step('wrong file type is refused on the page', async () => { await pub.locator('input[type=file]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from('x') }); await pub.getByText('Please choose a PDF, DOC or DOCX file.').waitFor() })
await step('oversized file is refused on the page', async () => { await pub.locator('input[type=file]').setInputFiles({ name: 'big.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(5.5 * 1024 * 1024, 1) }); await pub.getByText('larger than 5 MB').waitFor() })
await step('registering with a CV', async () => {
  await pub.getByLabel('Full name *').fill('Cv Candidate'); await pub.getByLabel('Email').fill('cvcandidate@example.com')
  await pub.locator('input[type=file]').setInputFiles({ name: 'My Resume.pdf', mimeType: 'application/pdf', buffer: pdf(0) })
  await pub.getByText('My Resume.pdf').waitFor(); await pub.getByRole('button', { name: 'Register' }).click(); await pub.getByText("You're registered").waitFor({ timeout: 10000 }) })

// 2. HR sees it
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
await ctx.addInitScript((s) => localStorage.setItem('hirerelay-session', JSON.stringify(s)), { token, user: { email: 'cv@example.com' } })
const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message))
await page.goto(`${B}/candidates`); await page.getByText('Cv Candidate').waitFor()
await step('paperclip shows in the list', async () => { await page.locator('tr', { hasText: 'Cv Candidate' }).getByLabel('Has a CV').waitFor() })
await step('profile shows the CV, and Open fetches the real bytes', async () => {
  await page.locator('tr', { hasText: 'Cv Candidate' }).locator('button.text-left').click(); await page.getByText('My Resume.pdf').waitFor()
  const [popup] = await Promise.all([page.context().waitForEvent('page'), page.getByRole('button', { name: 'Open' }).click()])
  await popup.waitForURL(/^blob:/, { timeout: 8000 }); const size = await popup.evaluate(async () => (await (await fetch(location.href)).arrayBuffer()).byteLength); if (size !== pdf(0).length) throw new Error(`size ${size}`); await popup.close() })
await step('replace the CV with a Word file', async () => {
  const doc = Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.alloc(30), Buffer.from('word/document.xml'), Buffer.alloc(100, 1)])
  await page.locator('input[type=file]').setInputFiles({ name: 'New CV.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: doc }); await page.getByText('New CV.docx').waitFor({ timeout: 8000 }); await page.getByRole('button', { name: /Download/ }).waitFor() })
await step('a fake PDF is refused by the server', async () => { await page.locator('input[type=file]').setInputFiles({ name: 'fake.pdf', mimeType: 'application/pdf', buffer: Buffer.from('this is plain text, not a PDF '.repeat(10)) }); await page.getByText(/PDF, DOC or DOCX/).first().waitFor({ timeout: 8000 }) })
await step('remove the CV', async () => { page.once('dialog', (d) => d.accept()); await page.getByLabel('Remove CV').click(); await page.getByText('No CV yet.').waitFor({ timeout: 8000 }) })
await step('upload a CV by hand', async () => { await page.locator('input[type=file]').setInputFiles({ name: 'Hand Uploaded.pdf', mimeType: 'application/pdf', buffer: pdf(1) }); await page.getByText('Hand Uploaded.pdf').waitFor({ timeout: 8000 }) })
await page.keyboard.press('Escape'); await page.getByLabel('Close').click()

// 3. assigning an interviewer queues the briefing with the CV attached
await step('assigning an interviewer queues a briefing that lists the CV', async () => {
  await j('PUT', '/api/settings', { auto_send_interviewer_briefing: false, auto_send_assignment_emails: false }, token)
  await page.reload(); await page.getByText('Cv Candidate').waitFor()
  await page.locator('tr', { hasText: 'Cv Candidate' }).getByLabel('Interviewer').selectOption({ label: 'Meera Shah' })
  await page.goto(`${B}/approvals`); await page.getByText(/Briefing for Meera Shah: Cv Candidate/).waitFor({ timeout: 8000 })
  await page.getByText('📎 Hand Uploaded.pdf').waitFor() })
console.log('errors:', JSON.stringify(errs)); await browser.close(); if (failed) process.exit(1)

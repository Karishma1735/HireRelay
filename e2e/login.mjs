import { chromium } from 'playwright-core'
const B = process.env.E2E_BASE || 'http://localhost:8788'
const email = `login-${Date.now()}@example.com`; const password = 'supersecret1'
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox'] })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message))
let failed = 0; const step = async (name, fn) => { try { await fn(); console.log('ok  ', name) } catch (e) { failed++; console.log('FAIL', name, '-', e.message.split('\n')[0]) } }
const submit = async (e, p) => { await page.fill('input[type=email]', e); await page.fill('input[type=password]', p); await page.locator('form button:not([type=button])').click() }
await page.goto(`${B}/drives`); await page.waitForSelector('input[type=email]')
await step('create an account from the form', async () => { await page.getByRole('button', { name: /Create an account/ }).click(); await submit(email, password); await page.getByRole('link', { name: 'Hiring drives' }).first().waitFor({ timeout: 8000 }) })
await step('sign out, then sign in again with the same account', async () => { await page.getByRole('button', { name: 'Sign out' }).click(); await page.waitForSelector('input[type=email]'); await submit(email, password); await page.getByRole('link', { name: 'Hiring drives' }).first().waitFor({ timeout: 8000 }) })
await step('a wrong password says so, in plain words', async () => { await page.getByRole('button', { name: 'Sign out' }).click(); await page.waitForSelector('input[type=email]'); await submit(email, 'not-the-password'); await page.getByText('Wrong email or password').waitFor({ timeout: 6000 }) })
console.log('errors:', JSON.stringify(errs)); await browser.close(); if (failed) process.exit(1)

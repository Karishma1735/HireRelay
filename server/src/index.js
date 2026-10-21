import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

// Local convenience: load ../.env when present. Hosted environments provide real environment variables.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
try { process.loadEnvFile(path.join(root, '.env')) } catch { /* no .env file */ }

const { createApp } = await import('./app.js')
const { config } = await import('./config.js')
const { getDb } = await import('./db.js')
const { describeStorage } = await import('./db.js')
// Open (and migrate) the database before accepting traffic. If that fails, keep serving and log exactly why,
// so the host's logs say what is wrong instead of the process dying with no output.
try {
  await getDb()
  console.log('database ok', JSON.stringify(describeStorage()))
} catch (e) {
  console.error('DATABASE UNAVAILABLE:', e.message, JSON.stringify(describeStorage()))
}

const dist = path.join(root, 'client/dist')
const app = createApp({ staticDir: fs.existsSync(dist) ? dist : undefined })
const server = app.listen(config.port, '0.0.0.0', () => console.log(`HireRelay on 0.0.0.0:${config.port}`))

const { startFormPoller } = await import('./lib/formPoller.js')
if (startFormPoller()) console.log(`checking Google Forms for new responses every ${process.env.FORM_POLL_SECONDS ?? 30}s`)

// Release the database (and its lock) on a normal stop.
const { closeDb } = await import('./db.js')
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { server.close(); try { closeDb() } catch { /* already closed */ } process.exit(0) })

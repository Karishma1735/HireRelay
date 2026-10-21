import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

// Local convenience: load ../.env when present. Hosted environments provide real environment variables.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
try { process.loadEnvFile(path.join(root, '.env')) } catch { /* no .env file */ }

const { createApp } = await import('./app.js')
const { config } = await import('./config.js')
const { getDb } = await import('./db.js')
const { query } = await import('./db.js')
await getDb() // open (and migrate) the database before accepting traffic
// Fail at boot, with a readable log, rather than on the first user request.
await query('create table if not exists _boot (at text)'); await query('delete from _boot'); await query("insert into _boot values (strftime('%Y-%m-%dT%H:%M:%fZ','now'))")
console.log(`database ok at ${config.dataDir}: ${fs.readdirSync(config.dataDir).join(', ')}`)

const dist = path.join(root, 'client/dist')
const app = createApp({ staticDir: fs.existsSync(dist) ? dist : undefined })
const server = app.listen(config.port, '0.0.0.0', () => console.log(`HireRelay on 0.0.0.0:${config.port}`))

// Release the database (and its lock) on a normal stop.
const { closeDb } = await import('./db.js')
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { server.close(); try { closeDb() } catch { /* already closed */ } process.exit(0) })

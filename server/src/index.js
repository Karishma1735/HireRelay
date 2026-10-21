import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

// Local convenience: load ../.env when present. Hosted environments provide real environment variables.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
try { process.loadEnvFile(path.join(root, '.env')) } catch { /* no .env file */ }

const { createApp } = await import('./app.js')
const { config } = await import('./config.js')
const { getDb } = await import('./db.js')
await getDb() // open (and migrate) the database before accepting traffic

const dist = path.join(root, 'client/dist')
const app = createApp({ staticDir: fs.existsSync(dist) ? dist : undefined })
app.listen(config.port, '0.0.0.0', () => console.log(`HireRelay on 0.0.0.0:${config.port}`))

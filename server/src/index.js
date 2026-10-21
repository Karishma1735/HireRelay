import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.js'
import { config } from './config.js'

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist')
const app = createApp({ staticDir: fs.existsSync(dist) ? dist : undefined })
app.listen(config.port, () => console.log(`HireRelay API on http://localhost:${config.port}`))

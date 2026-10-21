import os from 'node:os'
import path from 'node:path'
import { createApp } from '../src/app.js'
import { closeDb } from '../src/db.js'

// Tests run against the real embedded database (in memory) and the real signup/login routes.
process.env.DB_MEMORY = '1'
process.env.DATA_DIR = path.join(os.tmpdir(), `hirerelay-test-${process.pid}`)
process.env.INGEST_SECRET = 'test-ingest-secret'
process.env.VIASOCKET_ORG_ID = '80251'
process.env.VIASOCKET_PROJECT_ID = 'proj1pVRqxu9'
process.env.VIASOCKET_API_URL = 'https://flow-api.viasocket.com'
process.env.VIASOCKET_RUN_URL = 'https://flow.sokt.io'
delete process.env.VIASOCKET_EMBED_SECRET

export async function start() {
  await closeDb() // fresh in-memory database
  const server = createApp().listen(0)
  const base = `http://127.0.0.1:${server.address().port}`
  const call = async (token, method, url, body, headers = {}) => {
    const res = await fetch(base + url, {
      method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    return { status: res.status, body: await res.json().catch(() => null) }
  }
  const signup = async (email) => (await call(null, 'POST', '/api/auth/signup', { email, password: 'correct-horse-9' })).body
  const [a, b] = [await signup('a@hr.test'), await signup('b@hr.test')]
  const as = (s) => (m, u, body, h) => call(s?.token, m, u, body, h)
  return {
    a: as(a), b: as(b), anon: as(null), users: { a: a.user, b: b.user },
    stop: async () => { server.close(); await closeDb() }
  }
}

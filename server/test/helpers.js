import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import pg from 'pg'
import { createApp } from '../src/app.js'
import { closePool } from '../src/db.js'

// Tests need a Postgres they may wipe. A plain Postgres is enough: the backend talks to it with `pg`,
// and Supabase Auth is the only thing replaced (by an injected token verifier).
export const TEST_DB = process.env.TEST_DATABASE_URL || 'postgresql://postgres@localhost:54399/hirerelay_test'
process.env.DATABASE_URL = TEST_DB
process.env.INGEST_SECRET = 'test-ingest-secret'
process.env.VIASOCKET_ORG_ID = '80251'
process.env.VIASOCKET_PROJECT_ID = 'proj1pVRqxu9'
process.env.VIASOCKET_API_URL = 'https://flow-api.viasocket.com'
process.env.VIASOCKET_RUN_URL = 'https://flow.sokt.io'
delete process.env.VIASOCKET_EMBED_SECRET

const migration = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../supabase/migrations/20261021000000_init.sql'), 'utf8')

export async function resetDb() {
  const c = new pg.Client({ connectionString: TEST_DB }); await c.connect()
  await c.query('drop schema if exists public cascade; drop schema if exists auth cascade; create schema public; create schema auth; create table auth.users (id uuid primary key, email text)')
  await c.query(migration)
  await c.end()
}

export const users = { a: { id: crypto.randomUUID(), email: 'a@hr.test' }, b: { id: crypto.randomUUID(), email: 'b@hr.test' } }

export async function start() {
  await resetDb()
  const c = new pg.Client({ connectionString: TEST_DB }); await c.connect()
  for (const u of Object.values(users)) await c.query('insert into auth.users (id, email) values ($1,$2)', [u.id, u.email])
  await c.end()
  const verifyToken = async (t) => Object.values(users).find((u) => `tok-${u.id}` === t) || null
  const server = createApp({ verifyToken }).listen(0)
  const base = `http://127.0.0.1:${server.address().port}`
  const api = (who) => async (method, url, body, headers = {}) => {
    const res = await fetch(base + url, {
      method, headers: { 'content-type': 'application/json', ...(who ? { authorization: `Bearer tok-${users[who].id}` } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    return { status: res.status, body: await res.json().catch(() => null) }
  }
  return { a: api('a'), b: api('b'), anon: api(null), stop: async () => { server.close(); await closePool() } }
}

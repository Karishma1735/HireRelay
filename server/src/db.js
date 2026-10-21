import pg from 'pg'
import { config } from './config.js'

pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v))) // numeric -> number
pg.types.setTypeParser(1082, (v) => v) // date stays 'YYYY-MM-DD'

let pool
export function getPool() {
  if (!pool) {
    if (!config.databaseUrl) throw Object.assign(new Error('DATABASE_URL is not set'), { status: 503, code: 'database_not_configured' })
    pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 })
  }
  return pool
}
export async function closePool() { if (pool) { await pool.end(); pool = undefined } }

export const query = (text, params) => getPool().query(text, params)
export const one = async (text, params) => (await query(text, params)).rows[0] || null
export const many = async (text, params) => (await query(text, params)).rows

export async function tx(fn) {
  const client = await getPool().connect()
  try {
    await client.query('begin')
    const out = await fn(client)
    await client.query('commit')
    return out
  } catch (e) {
    await client.query('rollback').catch(() => {})
    throw e
  } finally { client.release() }
}

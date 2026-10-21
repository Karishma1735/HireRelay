import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { config } from './config.js'

// SQLite under DATA_DIR: the one file survives redeploys. DB_MEMORY=1 keeps it in memory (tests).
const schema = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../schema.sql'), 'utf8')

// Columns stored as JSON text / 0-1 integers, converted back on the way out.
const JSON_COLS = new Set(['field_map', 'extra', 'payload', 'request', 'response', 'config', 'input_data', 'drive'])
const BOOL_COLS = new Set(['active', 'auto_send_confirmations', 'has_feedback', 'live', 'enabled', 'google_form_connected'])

let db
export function getDb() {
  if (db) return db
  let file = ':memory:'
  if (!process.env.DB_MEMORY) { fs.mkdirSync(config.dataDir, { recursive: true }); file = path.join(config.dataDir, 'hirerelay.db') }
  db = new Database(file)
  db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON')
  db.function('now', () => new Date().toISOString())
  db.function('gen_uuid', () => crypto.randomUUID())
  db.exec(schema)
  return db
}
export function closeDb() { if (db) { db.close(); db = undefined; cache.clear() } }

const cache = new Map()
/** `$1`-style numbered parameters (reusable) become positional `?`, with arguments in order of appearance. */
function compile(text) {
  let c = cache.get(text)
  if (!c) {
    const order = []
    const sql = text.replace(/\$(\d+)/g, (_, n) => { order.push(Number(n) - 1); return '?' })
    c = { stmt: getDb().prepare(sql), order }
    cache.set(text, c)
  }
  return c
}
const toDb = (v) => (typeof v === 'boolean' ? Number(v) : v !== null && typeof v === 'object' ? JSON.stringify(v) : v)
function fromDb(row) {
  for (const k of Object.keys(row)) {
    const v = row[k]
    if (JSON_COLS.has(k) && typeof v === 'string') { try { row[k] = JSON.parse(v) } catch { /* leave as text */ } }
    else if (BOOL_COLS.has(k) && v !== null) row[k] = Boolean(v)
  }
  return row
}

export async function query(text, params = []) {
  const { stmt, order } = compile(text)
  const args = order.map((i) => toDb(params[i]))
  try {
    if (stmt.reader) return { rows: stmt.all(...args).map(fromDb) }
    stmt.run(...args); return { rows: [] }
  } catch (e) {
    if (String(e.code).startsWith('SQLITE_CONSTRAINT_UNIQUE') || e.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') e.code = '23505' // keep the existing unique-violation handling
    throw e
  }
}
export const one = async (text, params) => (await query(text, params)).rows[0] || null
export const many = async (text, params) => (await query(text, params)).rows

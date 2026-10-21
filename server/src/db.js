import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite' // built into Node >= 22.13: no native addon, supports WAL
import { config } from './config.js'

// SQLite under DATA_DIR: the one file survives redeploys. DB_MEMORY=1 keeps it in memory (tests).
// `now()` and `gen_uuid()` are written in the SQL and expanded here to plain SQLite expressions.
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')"
const UUID = "lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-a'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6)))"
const expand = (sql) => sql.replace(/\bnow\(\)/g, NOW).replace(/\bgen_uuid\(\)/g, UUID)
const schema = expand(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../schema.sql'), 'utf8'))

// Columns stored as JSON text / 0-1 integers, converted back on the way out.
const JSON_COLS = new Set(['field_map', 'extra', 'payload', 'request', 'response', 'config', 'input_data', 'drive'])
const BOOL_COLS = new Set(['active', 'auto_send_confirmations', 'has_feedback', 'live', 'enabled', 'google_form_connected'])

let db
export function getDb() {
  if (db) return db
  let file = ':memory:'
  if (!process.env.DB_MEMORY) { fs.mkdirSync(config.dataDir, { recursive: true }); file = path.join(config.dataDir, 'hirerelay.db') }
  db = new DatabaseSync(file)
  db.exec('pragma foreign_keys = ON')
  if (file !== ':memory:') db.exec('pragma journal_mode = WAL') // Embarko replicates SQLite files under DATA_DIR, which needs WAL
  db.exec(schema)
  return db
}
export function closeDb() { if (db) { db.close(); db = undefined; cache.clear() } }

/** What the boot check reports when the database cannot be opened: enough to diagnose from the host's logs. */
export function describeStorage() {
  const dir = config.dataDir; const out = { dir, uid: process.getuid?.(), node: process.version }
  try { out.files = fs.readdirSync(dir).map((f) => { const st = fs.statSync(path.join(dir, f)); return `${f} ${st.size}b mode=${(st.mode & 0o777).toString(8)}` }) } catch (e) { out.listError = e.message }
  try { fs.accessSync(dir, fs.constants.W_OK); out.writable = true } catch (e) { out.writable = false; out.writeError = e.message }
  return out
}

const cache = new Map()
const returnsRows = (sql) => /^\s*(select|with|pragma)\b/i.test(sql) || /\breturning\b/i.test(sql)
/** `$1`-style numbered parameters (reusable) become positional `?`, with arguments in order of appearance. */
function compile(text) {
  let c = cache.get(text)
  if (!c) {
    const order = []
    const sql = text.replace(/\$(\d+)/g, (_, n) => { order.push(Number(n) - 1); return '?' })
    c = { stmt: getDb().prepare(expand(sql)), order, reader: returnsRows(sql) }
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
  const { stmt, order, reader } = compile(text)
  const args = order.map((i) => toDb(params[i]))
  try {
    if (reader) return { rows: stmt.all(...args).map((r) => fromDb({ ...r })) }
    stmt.run(...args); return { rows: [] }
  } catch (e) {
    if (/UNIQUE constraint failed/i.test(e.message)) e.code = '23505' // keep the existing unique-violation handling
    throw e
  }
}
export const one = async (text, params) => (await query(text, params)).rows[0] || null
export const many = async (text, params) => (await query(text, params)).rows

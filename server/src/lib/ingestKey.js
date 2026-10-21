import crypto from 'node:crypto'
import { config } from '../config.js'

/** Per-drive key baked into the viaSocket handler. Derived, so nothing extra is stored. */
export function ingestKeyFor(driveId) {
  if (!config.ingestSecret) throw Object.assign(new Error('INGEST_SECRET is not set'), { status: 503, code: 'ingest_secret_missing' })
  return crypto.createHmac('sha256', config.ingestSecret).update(`drive:${driveId}`).digest('hex')
}
export function verifyIngestKey(driveId, key) {
  if (!config.ingestSecret || typeof key !== 'string') return false
  const a = Buffer.from(ingestKeyFor(driveId)); const b = Buffer.from(key)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import Busboy from 'busboy'
import { config } from '../config.js'
import { one, query } from '../db.js'
import { signValue } from '../auth.js'

export const MAX_CV_BYTES = 5 * 1024 * 1024
const dir = () => { const d = path.join(config.dataDir, 'cvs'); fs.mkdirSync(d, { recursive: true, mode: 0o700 }); return d }

/** What the file really is, from its first bytes: a renamed .exe or a text file called cv.pdf is refused. */
export function detectType(buf) {
  if (buf.length > 8 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return { ext: 'pdf', mime: 'application/pdf' }
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) return { ext: 'doc', mime: 'application/msword' }
  if (buf.length > 30 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 3 && buf[3] === 4 && buf.includes('word/'))
    return { ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
  return null
}
export const CV_TYPE_MESSAGE = 'Please upload your CV as a PDF, DOC or DOCX file (up to 5 MB).'

const safeName = (name, ext) => {
  const stem = path.basename(String(name || 'cv')).replace(/\.[^.]*$/, '').replace(/[\x00-\x1f\x7f"\\/<>:|?*]/g, '_').trim().slice(0, 100) || 'cv'
  return `${stem}.${ext}`
}

/** Reads a multipart request into text fields plus at most one file held in memory (capped). */
export function readMultipart(req, maxFileBytes = MAX_CV_BYTES) {
  return new Promise((resolve, reject) => {
    const bb = Busboy({ headers: req.headers, limits: { files: 1, fileSize: maxFileBytes, fields: 30, fieldSize: 20_000 } })
    const fields = {}; let file = null; let tooBig = false
    bb.on('field', (name, value) => { fields[name] = value })
    bb.on('file', (_name, stream, info) => {
      const chunks = []
      stream.on('data', (c) => chunks.push(c)); stream.on('limit', () => { tooBig = true })
      stream.on('end', () => { if (info.filename && chunks.length) file = { buffer: Buffer.concat(chunks), filename: info.filename } })
    })
    bb.on('error', reject)
    bb.on('close', () => (tooBig ? reject(Object.assign(new Error('That file is too large. The limit is 5 MB.'), { status: 413 })) : resolve({ fields, file })))
    req.pipe(bb)
  })
}

export const cvOf = (candidateId, ownerId) => one(`select * from candidate_files where candidate_id = $1 and owner_id = $2 and kind = 'cv'`, [candidateId, ownerId])
export const filePath = (f) => path.join(dir(), f.storage_name)

/** Stores (or replaces) a candidate's CV. Returns null when the bytes are not an allowed document type. */
export async function saveCv(ownerId, candidateId, { buffer, filename }, source = 'upload') {
  const type = detectType(buffer)
  if (!type || buffer.length > MAX_CV_BYTES) return null
  const storage = `${crypto.randomUUID()}.${type.ext}`
  fs.writeFileSync(path.join(dir(), storage), buffer, { mode: 0o600 })
  const old = await cvOf(candidateId, ownerId)
  await query(`delete from candidate_files where candidate_id = $1 and kind = 'cv'`, [candidateId])
  const row = await one(
    `insert into candidate_files (owner_id, candidate_id, original_name, mime, size, storage_name, source) values ($1,$2,$3,$4,$5,$6,$7) returning *`,
    [ownerId, candidateId, safeName(filename, type.ext), type.mime, buffer.length, storage, source])
  if (old) fs.rmSync(filePath(old), { force: true })
  return row
}

/** Removes the file from disk and its row. Called before a candidate is deleted (the row alone would leave the bytes behind). */
export async function removeCv(candidateId, ownerId) {
  const f = await cvOf(candidateId, ownerId)
  if (!f) return false
  fs.rmSync(filePath(f), { force: true })
  await query('delete from candidate_files where id = $1', [f.id])
  return true
}

// ---- expiring, unguessable download links (used to attach a CV to an email through viaSocket) ----
export function cvLinkPath(file, ttlSeconds = 3600) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds
  return `/api/files/cv/${file.id}.${exp}.${signValue('cv-link', `${file.id}.${exp}`)}/${encodeURIComponent(file.original_name)}`
}
export const cvLinkUrl = (file, ttl) => `${config.publicUrl}${cvLinkPath(file, ttl)}`

export function verifyCvToken(token) {
  const [id, exp, sig] = String(token).split('.')
  if (!id || !exp || !sig || !/^\d+$/.test(exp)) return null
  const good = signValue('cv-link', `${id}.${exp}`)
  const a = Buffer.from(sig), b = Buffer.from(good)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  return Number(exp) * 1000 > Date.now() ? { fileId: id } : { expired: true }
}

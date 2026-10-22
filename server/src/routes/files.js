import fs from 'node:fs'
import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { one } from '../db.js'
import { verifyCvToken, filePath } from '../lib/files.js'

const headers = (res, f) => {
  res.setHeader('Content-Type', f.mime)
  res.setHeader('Content-Disposition', `attachment; filename="${f.original_name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(f.original_name)}`)
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
}
export function sendFile(res, f) {
  headers(res, f); res.setHeader('Content-Length', f.size)
  const stream = fs.createReadStream(filePath(f))
  stream.on('error', () => { if (!res.headersSent) res.status(404).json({ error: 'File not found' }); else res.destroy() })
  stream.pipe(res)
}

/** The expiring link that lets the email service fetch a CV to attach it. The signature is the only credential. */
export function fileRoutes() {
  const r = Router()
  r.get('/files/cv/:token/:name?', rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false }), async (req, res) => {
    const v = verifyCvToken(req.params.token)
    if (!v) return res.status(403).json({ error: 'Invalid link' })
    if (v.expired) return res.status(410).json({ error: 'This link has expired' })
    const f = await one('select * from candidate_files where id = $1', [v.fileId])
    if (!f) return res.status(404).json({ error: 'File not found' })
    sendFile(res, f)
  })
  return r
}

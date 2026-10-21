import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { ZodError } from 'zod'
import { verifyToolToken } from '../auth.js'
import { TOOLS } from '../lib/agentTools.js'

/** Called by viaSocket's AI while it answers an HR question. Authenticated by a short-lived per-user tool token. */
export function agentToolRoutes() {
  const r = Router()
  r.use('/agent-tools', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }))
  r.post('/agent-tools/:name', async (req, res) => {
    const header = req.headers.authorization || ''
    const ownerId = verifyToolToken(header.startsWith('Bearer ') ? header.slice(7) : '')
    if (!ownerId) return res.status(401).json({ error: 'Invalid or expired tool token' })
    const tool = Object.hasOwn(TOOLS, req.params.name) ? TOOLS[req.params.name] : null
    if (!tool) return res.status(404).json({ error: 'Unknown tool' })
    try {
      res.json(await tool.run(ownerId, tool.schema.parse(req.body && typeof req.body === 'object' ? req.body : {})))
    } catch (e) {
      // Tell the model what was wrong with its arguments so it can try again.
      if (e instanceof ZodError) return res.status(400).json({ error: 'Invalid arguments', details: e.issues.map((i) => `${i.path.join('.')}: ${i.message}`) })
      throw e
    }
  })
  return r
}

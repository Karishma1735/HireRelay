import { Router } from 'express'
import { z } from 'zod'
import * as vs from '../lib/viasocket.js'
import { AGENT_PROMPT, AGENT_SCHEMA, buildSnapshot, validProposals } from '../lib/agent.js'
import { toolDefinitions } from '../lib/agentTools.js'
import { signToolToken } from '../auth.js'
import { config, isPublicUrl } from '../config.js'
import { many } from '../db.js'
import { one } from '../db.js'
import { requestApproval } from '../lib/approvals.js'
import { interviewReminder, feedbackReminder } from '../lib/emails.js'

export function agentRoutes() {
  const r = Router()

  /**
   * The agent answers from a live snapshot of the HR user's data, passed in the message.
   * Whatever it proposes is validated against real rows and only queued as approvals.
   * The model runs on viaSocket (AI in the product): HireRelay holds no model key.
   */
  r.post('/message', async (req, res) => {
    const b = z.object({ message: z.string().trim().min(1).max(2000), thread_id: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/) }).parse(req.body)
    const owner = req.user.id
    if (!vs.isConfigured()) return res.status(503).json({ error: `The AI agent runs on viaSocket and needs ${vs.missingConfig().join(', ')} in .env.`, code: 'viasocket_not_configured' })
    const snapshot = await buildSnapshot(owner)
    // The lookup tools are called back by viaSocket over the internet, so they need a public address; without one
    // (local development) the agent still answers from the summary alone.
    const tools = isPublicUrl(config.publicUrl) ? toolDefinitions(config.publicUrl, signToolToken(owner)) : []
    const data = await vs.askAI(owner, {
      thread_id: `hr-${owner.slice(0, 8)}-${b.thread_id}`.slice(0, 100),
      prompt: AGENT_PROMPT,
      message: `${b.message}\n\nCurrent summary (JSON, a starting point only):\n${JSON.stringify(snapshot)}`,
      response_type: 'json_schema', json_schema: AGENT_SCHEMA,
      ...(tools.length ? { extra_tools: tools } : {})
    })
    const reply = typeof data.content === 'string' ? JSON.parse(data.content) : data.content
    const queued = []
    for (const p of await validProposals(owner, reply.proposed_actions)) {
      if (p.type === 'interview_reminder') {
        const c = await one(`select c.*, json_object('name', d.name, 'role_title', d.role_title, 'venue', d.venue, 'drive_date', d.drive_date) as drive from candidates c join drives d on d.id = c.drive_id where c.id = $1 and c.owner_id = $2 and c.email is not null`, [p.candidate_id, owner])
        if (!c) continue
        queued.push(await requestApproval(owner, { email: interviewReminder(c, c.drive), candidateId: c.id, requestedBy: 'agent', title: `Interview reminder to ${c.full_name}`, reason: p.reason }))
      } else {
        const items = await many(
          `select c.full_name, c.role_applied, i.name as iname, i.email as iemail from candidates c join interviewers i on i.id = c.interviewer_id left join feedback f on f.candidate_id = c.id
           where i.id = $1 and i.owner_id = $2 and c.interview_completed_at is not null and f.id is null`, [p.interviewer_id, owner])
        const iv = items[0] && { name: items[0].iname, email: items[0].iemail }
        if (!iv?.email) continue
        queued.push(await requestApproval(owner, { email: feedbackReminder(iv, items.map((x) => ({ full_name: x.full_name, role_applied: x.role_applied }))), requestedBy: 'agent', title: `Feedback reminder to ${iv.name} (${items.length} pending)`, reason: p.reason }))
      }
    }
    res.json({ answer: reply.answer, recommendations: reply.recommendations || [], queued_approvals: queued.map((a) => ({ id: a.id, title: a.title })), thread_id: b.thread_id })
  })

  r.get('/history/:threadId', async (req, res) => {
    const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).parse(req.params.threadId)
    if (!vs.isConfigured()) return res.json({ messages: [] })
    const data = await vs.aiHistory(req.user.id, `hr-${req.user.id.slice(0, 8)}-${id}`.slice(0, 100))
    res.json({ messages: data?.messages || [] })
  })
  return r
}

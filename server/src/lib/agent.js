import { dashboardMetrics, waitingList, pendingFeedbackList } from './metrics.js'
import { many } from '../db.js'

export const AGENT_SCHEMA = {
  name: 'hr_agent_reply',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['answer', 'recommendations', 'proposed_actions'],
    properties: {
      answer: { type: 'string', description: 'Direct answer to the HR question, using only the data snapshot.' },
      recommendations: { type: 'array', items: { type: 'string' }, description: 'Short next-step suggestions grounded in the snapshot.' },
      proposed_actions: {
        type: 'array',
        description: 'Emails HR may want sent. They are only queued for approval, never sent.',
        items: {
          type: 'object', additionalProperties: false,
          required: ['type', 'candidate_id', 'interviewer_id', 'reason'],
          properties: {
            type: { type: 'string', enum: ['interview_reminder', 'feedback_reminder'] },
            candidate_id: { type: ['string', 'null'], description: 'For interview_reminder: id of a waiting candidate from the snapshot.' },
            interviewer_id: { type: ['string', 'null'], description: 'For feedback_reminder: id of an interviewer from the pending-feedback list.' },
            reason: { type: 'string' }
          }
        }
      }
    }
  }
}

export const AGENT_PROMPT = `You are HireRelay Agent, an operations assistant for HR running a walk-in hiring drive.
Answer ONLY from the JSON data snapshot included in the user's message; it is read live from the database. If the snapshot cannot answer, say so.
Never invent candidates, numbers or ids. Never say an email was sent: you can only propose actions, which HR must approve.
Propose an interview_reminder only for candidates in waiting_list, and a feedback_reminder only for interviewers present in pending_feedback.
Keep answers short and specific; use counts and names from the snapshot.`

export async function buildSnapshot(ownerId) {
  const [metrics, waiting, pending, drives] = await Promise.all([
    dashboardMetrics(ownerId), waitingList(ownerId, null, 40), pendingFeedbackList(ownerId, null, 40),
    many(`select id, name, role_title, venue, drive_date, status from drives where owner_id = $1 order by created_at desc limit 10`, [ownerId])
  ])
  return { generated_at: new Date().toISOString(), metrics, drives, waiting_list: waiting, pending_feedback: pending }
}

/** Keeps only proposals that point at real rows owned by this HR user. */
export function validProposals(proposals, snapshot) {
  const waiting = new Map(snapshot.waiting_list.map((c) => [c.id, c]))
  const ivs = new Set(snapshot.pending_feedback.map((p) => p.interviewer_id).filter(Boolean))
  return (proposals || []).filter((p) =>
    (p.type === 'interview_reminder' && waiting.has(p.candidate_id)) ||
    (p.type === 'feedback_reminder' && ivs.has(p.interviewer_id)))
}

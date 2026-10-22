import { dashboardMetrics, waitingList, pendingFeedbackList } from './metrics.js'
import { many, one } from '../db.js'

export const AGENT_SCHEMA = {
  name: 'hr_agent_reply',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['answer', 'recommendations', 'proposed_actions'],
    properties: {
      answer: { type: 'string', description: 'The reply to the HR question, in plain natural language.' },
      recommendations: { type: 'array', items: { type: 'string' }, description: 'Short, useful next steps. Empty when there is nothing worth suggesting.' },
      proposed_actions: {
        type: 'array',
        description: 'Emails HR may want sent. They are only queued for approval, never sent.',
        items: {
          type: 'object', additionalProperties: false,
          required: ['type', 'candidate_id', 'interviewer_id', 'reason'],
          properties: {
            type: { type: 'string', enum: ['interview_reminder', 'feedback_reminder'] },
            candidate_id: { type: ['string', 'null'], description: 'For interview_reminder: the id of a waiting candidate, copied from a lookup result.' },
            interviewer_id: { type: ['string', 'null'], description: 'For feedback_reminder: the id of an interviewer who owes feedback, copied from a lookup result.' },
            reason: { type: 'string' }
          }
        }
      }
    }
  }
}

export const AGENT_PROMPT = `You are HireRelay Agent, the operations assistant for an HR user running walk-in hiring drives.

Where your facts come from
- The user message starts with a short current summary (totals and the waiting queue). It is only a starting point and is not the whole picture.
- For anything more specific, call the lookup tools: search_candidates, get_candidate, list_feedback, list_drives, list_interviewers, list_emails, recent_activity, get_overview. Use them freely; they read live data. For example, "the latest rejected candidate" means search_candidates with stage rejected, newest first.
- Answer only from what the summary and the tools return. Never invent a person, number, date or id. If a lookup finds nothing, say so plainly ("I couldn't find any rejected candidates").

How to answer
- Speak naturally and concisely, like a helpful colleague. Lead with the answer, then the useful detail (names, stage, drive, interviewer, times).
- Never mention "snapshot", "summary", tools, JSON, or how you work. Do not show ids unless the user asks for them.
- Use the user's wording for dates and times and say "n minutes ago" or the date, not raw timestamps.
- If a question is ambiguous (several people match), ask which one, listing the options.

Actions
- You cannot send, change or delete anything. You may propose an interview_reminder for a candidate who is waiting, or a feedback_reminder for an interviewer who owes feedback, using ids copied from lookup results. Everything you propose is queued for the user's approval; never say an email was sent.`

/** A small starting summary sent with each question. Deeper questions go through the lookup tools. */
export async function buildSnapshot(ownerId) {
  const [metrics, waiting, pending, drives] = await Promise.all([
    dashboardMetrics(ownerId), waitingList(ownerId, null, 20), pendingFeedbackList(ownerId, null, 20),
    many(`select name, role_title, venue, drive_date, status from drives where owner_id = $1 order by created_at desc limit 10`, [ownerId])
  ])
  const { stages, workflow_runs, last_sync, ...totals } = metrics
  return { as_of: new Date().toISOString(), totals, candidates_by_stage: stages, drives, waiting_now: waiting.map(({ id, full_name, queue_number, interviewer, role_applied }) => ({ id, name: full_name, queue_number, interviewer, role: role_applied })),
    feedback_owed: pending.map(({ id, full_name, interviewer, interviewer_id }) => ({ candidate_id: id, name: full_name, interviewer, interviewer_id })) }
}

/**
 * Keeps only proposals that point at real rows owned by this HR user, checked against the database
 * (the agent may have found them with a lookup, so the summary alone is not the reference).
 */
export async function validProposals(ownerId, proposals) {
  const ok = []
  for (const p of proposals || []) {
    if (p.type === 'interview_reminder' && p.candidate_id) {
      if (await one(`select 1 from candidates where id = $1 and owner_id = $2 and stage = 'waiting' and email is not null`, [p.candidate_id, ownerId])) ok.push(p)
    } else if (p.type === 'feedback_reminder' && p.interviewer_id) {
      if (await one(
        `select 1 from interviewers i where i.id = $1 and i.owner_id = $2 and i.email is not null and exists
           (select 1 from candidates c left join feedback f on f.candidate_id = c.id and f.round = c.round where c.interviewer_id = i.id and c.interview_completed_at is not null and f.id is null)`,
        [p.interviewer_id, ownerId])) ok.push(p)
    }
  }
  return ok
}

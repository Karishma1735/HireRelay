import { one, query } from '../db.js'
import { config } from '../config.js'
import * as vs from './viasocket.js'

/** Queues an email for HR approval. Nothing is sent until an HR user approves it. */
export async function requestApproval(ownerId, { email, candidateId = null, requestedBy = 'system', title, reason = null }) {
  return one(
    `insert into approvals (owner_id, kind, purpose, title, reason, payload, candidate_id, requested_by)
     values ($1,'send_email',$2,$3,$4,$5,$6,$7) returning *`,
    [ownerId, email.purpose, title, reason, { to: email.to, subject: email.subject, body: email.body }, candidateId, requestedBy])
}

/** Approve (atomically, once) and execute through viaSocket. Every outcome is written to workflow_runs. */
export async function approveAndExecute(ownerId, approvalId) {
  const approval = await one(
    `update approvals set status = 'approved', decided_at = now() where id = $1 and owner_id = $2 and status = 'pending' returning *`,
    [approvalId, ownerId])
  if (!approval) return null
  return execute(ownerId, approval)
}

export async function execute(ownerId, approval) {
  const run = await one(
    `insert into workflow_runs (owner_id, approval_id, candidate_id, kind, status, request)
     values ($1,$2,$3,$4,'running',$5) returning id`,
    [ownerId, approval.id, approval.candidate_id, `gmail.send_email:${approval.purpose}`, { to: approval.payload.to, subject: approval.payload.subject }])
  const finish = async (status, response, error) => {
    await query(`update workflow_runs set status = $2, response = $3, error = $4, finished_at = now() where id = $1`, [run.id, status, response ?? null, error ?? null])
    await query(`update approvals set status = $2, error = $3 where id = $1`, [approval.id, status === 'success' ? 'executed' : 'failed', error ?? null])
    return one('select * from approvals where id = $1', [approval.id])
  }
  try {
    if (!approval.payload.to) throw new Error('The recipient has no email address')
    const conn = await one(`select * from viasocket_connections where owner_id = $1 and service_id = $2`, [ownerId, config.viasocket.gmail.serviceId])
    if (!conn?.script_id) throw new Error('Gmail is not connected. Connect it on the Integrations page.')
    if (!conn.config?.from) throw new Error('Choose the Gmail sender address on the Integrations page first.')
    const response = await vs.runAction(conn.script_id, config.viasocket.gmail.sendActionVersionId, {
      to: approval.payload.to, subject: approval.payload.subject, messageBody: approval.payload.body, from: conn.config.from
    })
    return await finish('success', response, null)
  } catch (e) {
    return await finish('failed', e.detail ?? null, e.message)
  }
}

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { get, post, put } from '../lib/api.js'
import { ago } from '../lib/format.js'
import { Alert, Badge, Button, Card, Empty, Spinner } from '../components/ui.jsx'

const TONE = { pending: 'amber', approved: 'indigo', executed: 'green', rejected: 'slate', failed: 'red', success: 'green', running: 'amber', created: 'green', duplicate: 'amber', rejected_: 'red', error: 'red' }

export default function Approvals() {
  const qc = useQueryClient(); const [tab, setTab] = useState('pending'); const [error, setError] = useState(''); const [open, setOpen] = useState(null)
  const refresh = () => { ['approvals', 'runs', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })) }
  const approvals = useQuery({ queryKey: ['approvals', tab], queryFn: () => get(tab === 'pending' ? '/approvals?status=pending' : '/approvals'), enabled: tab !== 'runs' && tab !== 'sync', refetchInterval: 8000 })
  const runs = useQuery({ queryKey: ['runs'], queryFn: () => get('/runs'), enabled: tab === 'runs', refetchInterval: 8000 })
  const sync = useQuery({ queryKey: ['ingest-events'], queryFn: () => get('/ingest-events'), enabled: tab === 'sync', refetchInterval: 8000 })
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => get('/settings') })
  const act = useMutation({ mutationFn: ({ id, what }) => post(`/approvals/${id}/${what}`), onSuccess: refresh, onError: (e) => setError(e.message) })
  const all = useMutation({ mutationFn: () => post('/approvals/approve-all'), onSuccess: refresh, onError: (e) => setError(e.message) })
  const prep = useMutation({ mutationFn: (type) => post('/actions/prepare', { type }), onSuccess: (r) => { setError(''); refresh(); if (!r.created) setError('Nothing new to prepare: no matching candidates, or reminders are already pending.') }, onError: (e) => setError(e.message) })
  const auto = useMutation({ mutationFn: (v) => put('/settings', { auto_send_confirmations: v }), onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }) })
  const tabs = [['pending', 'Awaiting approval'], ['all', 'All approvals'], ['runs', 'Workflow executions'], ['sync', 'Form sync log']]
  return (
    <div className="space-y-4">
      <div><h1 className="text-2xl font-semibold">Approvals & activity</h1><p className="text-sm text-slate-500">Emails to candidates and interviewers are queued here. Nothing is sent until you approve it; then it runs through viaSocket and the real result is logged.</p></div>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" loading={prep.isPending && prep.variables === 'interview_reminders'} onClick={() => prep.mutate('interview_reminders')}>Prepare interview reminders</Button>
            <Button size="sm" variant="secondary" loading={prep.isPending && prep.variables === 'feedback_reminders'} onClick={() => prep.mutate('feedback_reminders')}>Prepare feedback reminders</Button></div>
          <label className="flex items-center gap-2 text-sm text-slate-600" title="When on, registration confirmations are sent without waiting for approval. Reminders always need approval.">
            <input type="checkbox" checked={!!settings.data?.auto_send_confirmations} onChange={(e) => auto.mutate(e.target.checked)} /> Auto-send registration confirmations</label>
        </div>
      </Card>
      {error && <Alert tone="warn">{error}</Alert>}
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200">{tabs.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${tab === k ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500'}`}>{l}</button>)}</div>
      {tab === 'runs' ? (runs.isLoading ? <Spinner /> : !runs.data.length ? <Empty>No workflow has run yet.</Empty> : (
        <ul className="space-y-2">{runs.data.map((r) => (
          <li key={r.id} className="rounded-xl border border-slate-200 bg-white p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{r.title || r.kind}</span><span className="flex items-center gap-2"><Badge tone={TONE[r.status]}>{r.status}</Badge><span className="text-xs text-slate-400">{ago(r.started_at)}</span></span></div>
            <div className="text-xs text-slate-500">{r.kind} → {r.request?.to}</div>{r.error && <div className="mt-1 text-xs text-rose-600">{r.error}</div>}
            {r.response && <details className="mt-1"><summary className="cursor-pointer text-xs text-slate-500">viaSocket response</summary><pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-2 text-xs">{JSON.stringify(r.response, null, 2)}</pre></details>}</li>))}</ul>))
      : tab === 'sync' ? (sync.isLoading ? <Spinner /> : !sync.data.length ? <Empty>No form submissions yet.</Empty> : (
        <ul className="space-y-2">{sync.data.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3 text-sm"><span>{e.full_name || e.message || 'Submission'} <span className="text-xs text-slate-400">via {e.source}</span>{e.outcome !== 'created' && e.message && <span className="ml-2 text-xs text-slate-500">{e.message}</span>}</span>
            <span className="flex items-center gap-2"><Badge tone={TONE[e.outcome === 'rejected' ? 'rejected_' : e.outcome]}>{e.outcome}</Badge><span className="text-xs text-slate-400">{ago(e.created_at)}</span></span></li>))}</ul>))
      : approvals.isLoading ? <Spinner /> : (<>
        {tab === 'pending' && approvals.data?.length > 1 && <div className="flex justify-end"><Button size="sm" loading={all.isPending} onClick={() => all.mutate()}>Approve all ({approvals.data.length})</Button></div>}
        {!approvals.data?.length ? <Empty>{tab === 'pending' ? 'Nothing is waiting for approval.' : 'No approvals yet.'}</Empty> : (
          <ul className="space-y-2">{approvals.data.map((a) => (
            <li key={a.id} className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0"><button className="text-left font-medium hover:text-indigo-700" onClick={() => setOpen(open === a.id ? null : a.id)}>{a.title}</button>
                  <div className="text-xs text-slate-500">To {a.payload.to || 'no address'} · requested by {a.requested_by} · {ago(a.created_at)}</div>
                  {a.reason && <div className="mt-1 text-xs text-slate-600">Why: {a.reason}</div>}{a.error && <div className="mt-1 text-xs text-rose-600">{a.error}</div>}</div>
                <div className="flex items-center gap-2"><Badge tone={TONE[a.status]}>{a.status}</Badge>
                  {(a.status === 'failed' || a.status === 'executed') && <Button size="sm" variant="secondary" loading={act.isPending && act.variables?.id === a.id && act.variables.what === 'retry'} onClick={() => act.mutate({ id: a.id, what: 'retry' })}>{a.status === 'failed' ? 'Retry' : 'Send again'}</Button>}
                  {a.status === 'pending' && <><Button size="sm" loading={act.isPending && act.variables?.id === a.id && act.variables.what === 'approve'} onClick={() => act.mutate({ id: a.id, what: 'approve' })}>Approve & send</Button>
                    <Button size="sm" variant="secondary" onClick={() => act.mutate({ id: a.id, what: 'reject' })}>Reject</Button></>}</div>
              </div>
              {open === a.id && <div className="mt-2 rounded-lg bg-slate-50 p-3"><div className="mb-1 text-xs font-medium">Subject: {a.payload.subject}</div><iframe title="Email preview" sandbox="" srcDoc={a.payload.body} className="h-40 w-full rounded border border-slate-200 bg-white" /></div>}
            </li>))}</ul>)}</>)}
    </div>
  )
}

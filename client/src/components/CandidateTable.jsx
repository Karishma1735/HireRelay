import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { get, post, patch } from '../lib/api.js'
import { STAGE_LABEL } from '../lib/format.js'
import { Alert, Button, Empty, Field, Modal, Spinner, StageBadge } from './ui.jsx'

const NEXT = {
  registered: [['checked_in', 'Check in']], checked_in: [['waiting', 'Add to queue']], waiting: [['in_interview', 'Start interview']],
  in_interview: [['completed', 'Complete']], completed: [['selected', 'Select'], ['rejected', 'Reject']], no_show: [['registered', 'Reopen']]
}
const CAN_NO_SHOW = new Set(['registered', 'checked_in', 'waiting'])

export default function CandidateTable({ driveId, initialPendingFeedback = false }) {
  const qc = useQueryClient()
  const [q, setQ] = useState(''); const [stage, setStage] = useState(''); const [pendingFb, setPendingFb] = useState(initialPendingFeedback)
  const [open, setOpen] = useState(null); const [error, setError] = useState('')
  const params = new URLSearchParams({ ...(driveId && { drive_id: driveId }), ...(stage && { stage }), ...(q && { q }), ...(pendingFb && { pending_feedback: '1' }) })
  const list = useQuery({ queryKey: ['candidates', params.toString()], queryFn: () => get(`/candidates?${params}`), refetchInterval: 5000 })
  const ivs = useQuery({ queryKey: ['interviewers'], queryFn: () => get('/interviewers') })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['candidates'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); qc.invalidateQueries({ queryKey: ['drives'] }) }
  const move = useMutation({ mutationFn: ({ id, stage }) => post(`/candidates/${id}/stage`, { stage }), onSuccess: () => { setError(''); refresh() }, onError: (e) => setError(e.message) })
  const assign = useMutation({ mutationFn: ({ id, interviewer_id }) => patch(`/candidates/${id}/interviewer`, { interviewer_id: interviewer_id || null }), onSuccess: refresh, onError: (e) => setError(e.message) })
  const activeIvs = (ivs.data || []).filter((i) => i.active)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[180px] flex-1"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" /><input className="input !pl-8" placeholder="Search name, email or phone" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select className="input !w-auto" value={stage} onChange={(e) => setStage(e.target.value)}><option value="">All stages</option>{Object.entries(STAGE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={pendingFb} onChange={(e) => setPendingFb(e.target.checked)} /> Pending feedback</label>
      </div>
      {error && <Alert>{error}</Alert>}
      {list.isLoading ? <Spinner /> : !list.data?.length ? <Empty>No candidates match.</Empty> : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">#</th><th className="px-3 py-2">Candidate</th>{!driveId && <th className="px-3 py-2">Drive</th>}<th className="px-3 py-2">Stage</th><th className="px-3 py-2">Interviewer</th><th className="px-3 py-2 text-right">Actions</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {list.data.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 tabular-nums text-slate-400">{c.queue_number ?? ''}</td>
                  <td className="px-3 py-2"><button className="text-left font-medium text-slate-900 hover:text-indigo-700" onClick={() => setOpen(c.id)}>{c.full_name}</button>
                    <div className="text-xs text-slate-500">{[c.email, c.phone].filter(Boolean).join(' · ')}</div></td>
                  {!driveId && <td className="px-3 py-2 text-slate-600">{c.drive_name}</td>}
                  <td className="px-3 py-2"><StageBadge stage={c.stage} />{c.interview_completed_at && !c.has_feedback && <span className="ml-1 text-xs text-rose-600">feedback due</span>}</td>
                  <td className="px-3 py-2">
                    <select className="input !py-1 !text-xs" value={c.interviewer_id || ''} onChange={(e) => assign.mutate({ id: c.id, interviewer_id: e.target.value })} aria-label="Interviewer">
                      <option value="">Unassigned</option>{activeIvs.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                    </select></td>
                  <td className="px-3 py-2"><div className="flex justify-end gap-1.5">
                    {(NEXT[c.stage] || []).map(([to, label]) => (
                      <Button key={to} size="sm" variant={to === 'rejected' ? 'danger' : 'secondary'} disabled={to === 'in_interview' && !c.interviewer_id} title={to === 'in_interview' && !c.interviewer_id ? 'Assign an interviewer first' : undefined}
                        loading={move.isPending && move.variables?.id === c.id && move.variables?.stage === to} onClick={() => move.mutate({ id: c.id, stage: to })}>{label}</Button>))}
                    {c.interview_completed_at && !c.has_feedback && <Button size="sm" onClick={() => setOpen(c.id)}>Feedback</Button>}
                    {CAN_NO_SHOW.has(c.stage) && <Button size="sm" variant="ghost" onClick={() => move.mutate({ id: c.id, stage: 'no_show' })}>No show</Button>}
                  </div></td>
                </tr>))}
            </tbody>
          </table>
        </div>)}
      {open && <CandidateModal id={open} onClose={() => { setOpen(null); refresh() }} />}
    </div>
  )
}

function CandidateModal({ id, onClose }) {
  const qc = useQueryClient()
  const c = useQuery({ queryKey: ['candidate', id], queryFn: () => get(`/candidates/${id}`) })
  const [fb, setFb] = useState({ rating: 3, recommendation: 'hold', notes: '' }); const [error, setError] = useState('')
  const save = useMutation({ mutationFn: () => post(`/candidates/${id}/feedback`, fb), onSuccess: () => qc.invalidateQueries({ queryKey: ['candidate', id] }), onError: (e) => setError(e.message) })
  const d = c.data
  return (
    <Modal title={d?.full_name || 'Candidate'} onClose={onClose}>
      {!d ? <Spinner /> : (<div className="space-y-4 text-sm">
        <div className="flex items-center gap-2"><StageBadge stage={d.stage} /><span className="text-slate-500">{d.drive_name} · via {d.source.replace('_', ' ')}</span></div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
          {[['Email', d.email], ['Phone', d.phone], ['Role', d.role_applied], ['Experience', d.experience_years != null ? `${d.experience_years} yrs` : null], ['Company', d.current_company], ['Interviewer', d.interviewer_name]].map(([k, v]) => (
            <div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd className="break-words">{v || '—'}</dd></div>))}
        </dl>
        {Object.keys(d.extra || {}).length > 0 && <details className="rounded-lg bg-slate-50 p-3"><summary className="cursor-pointer text-xs font-medium text-slate-600">All form answers</summary>
          <dl className="mt-2 space-y-1">{Object.entries(d.extra).map(([k, v]) => <div key={k}><dt className="text-xs text-slate-500">{k.replace(/_/g, ' ')}</dt><dd>{v || '—'}</dd></div>)}</dl></details>}
        <div className="border-t pt-4">
          <h4 className="mb-2 font-semibold">Interview feedback</h4>
          {d.feedback ? (<div className="rounded-lg bg-emerald-50 p-3"><div>Rating <b>{d.feedback.rating}/5</b> · <b className="capitalize">{d.feedback.recommendation}</b></div>{d.feedback.notes && <p className="mt-1 text-slate-700">{d.feedback.notes}</p>}</div>)
            : !d.interview_completed_at ? <p className="text-slate-500">Feedback can be recorded once the interview is completed.</p>
            : (<form className="space-y-3" onSubmit={(e) => { e.preventDefault(); setError(''); save.mutate() }}>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Rating (1–5)"><select className="input" value={fb.rating} onChange={(e) => setFb({ ...fb, rating: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select></Field>
                <Field label="Recommendation"><select className="input" value={fb.recommendation} onChange={(e) => setFb({ ...fb, recommendation: e.target.value })}><option value="hire">Hire</option><option value="hold">Hold</option><option value="reject">Reject</option></select></Field>
              </div>
              <Field label="Notes"><textarea className="input" rows={3} value={fb.notes} onChange={(e) => setFb({ ...fb, notes: e.target.value })} /></Field>
              {error && <Alert>{error}</Alert>}<Button loading={save.isPending}>Save feedback</Button></form>)}
        </div>
      </div>)}
    </Modal>
  )
}

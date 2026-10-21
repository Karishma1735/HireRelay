import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Search, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import { get, post, patch, del } from '../lib/api.js'
import { STAGE_LABEL } from '../lib/format.js'
import { Alert, Button, Empty, Field, Modal, Spinner, StageBadge } from './ui.jsx'

// The 'Check in' label is swapped for 'Check in & queue' at render time when auto-queue is on.
const NEXT = {
  registered: [['checked_in', 'Check in']],
  checked_in: [['waiting', 'Add to queue']],
  waiting: [['in_interview', 'Start interview']],
  in_interview: [['completed', 'Complete']], completed: [['selected', 'Select'], ['rejected', 'Reject']], no_show: [['registered', 'Reopen']]
}
const CAN_NO_SHOW = new Set(['registered', 'checked_in', 'waiting'])

export default function CandidateTable({ driveId, interviewerId, initialPendingFeedback = false }) {
  const qc = useQueryClient()
  const [q, setQ] = useState(''); const [stage, setStage] = useState(''); const [pendingFb, setPendingFb] = useState(initialPendingFeedback)
  const [driveFilter, setDriveFilter] = useState('')
  const [open, setOpen] = useState(null); const [error, setError] = useState(''); const [sel, setSel] = useState(new Set())
  const params = new URLSearchParams({ ...((driveId || driveFilter) && { drive_id: driveId || driveFilter }), ...(interviewerId && { interviewer_id: interviewerId }), ...(stage && { stage }), ...(q && { q }), ...(pendingFb && { pending_feedback: '1' }) })
  const list = useQuery({ queryKey: ['candidates', params.toString()], queryFn: () => get(`/candidates?${params}`), refetchInterval: 5000 })
  const ivs = useQuery({ queryKey: ['interviewers'], queryFn: () => get('/interviewers') })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['candidates'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); qc.invalidateQueries({ queryKey: ['drives'] }); qc.invalidateQueries({ queryKey: ['interviewers'] }); qc.invalidateQueries({ queryKey: ['interviewer'] }) }
  const move = useMutation({ mutationFn: ({ id, stage }) => post(`/candidates/${id}/stage`, { stage }), onSuccess: () => { setError(''); refresh() }, onError: (e) => setError(e.message) })
  const assign = useMutation({ mutationFn: ({ id, interviewer_id }) => patch(`/candidates/${id}/interviewer`, { interviewer_id: interviewer_id || null }), onSuccess: refresh, onError: (e) => setError(e.message) })
  const remove = useMutation({
    mutationFn: (ids) => post('/candidates/delete', { ids }),
    onSuccess: () => { setSel(new Set()); setError(''); refresh() }, onError: (e) => setError(e.message)
  })
  const askDelete = (ids, label) => confirm(`Delete ${label}? Their feedback and any email waiting for approval are deleted too. This cannot be undone.`) && remove.mutate(ids)
  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const rows = list.data || []
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => get('/settings') })
  const autoQueue = settings.data?.auto_queue_on_check_in !== false
  const activeIvs = (ivs.data || []).filter((i) => i.active)

  const drives = useQuery({ queryKey: ['drives'], queryFn: () => get('/drives'), enabled: !driveId })
  const [collapsed, setCollapsed] = useState(new Set())
  // One section per hiring drive, newest drive first; drives with no matching candidates are left out.
  const groups = (drives.data || []).map((d) => ({ id: d.id, name: d.name, date: d.drive_date, rows: rows.filter((c) => c.drive_id === d.id) })).filter((g) => g.rows.length)

  const renderTable = (list) => (
    <table className="w-full min-w-[820px] table-fixed text-left text-sm">
      <colgroup><col className="w-10" /><col className="w-12" /><col /><col className="w-36" /><col className="w-44" /><col className="w-[300px]" /></colgroup>
      <thead className="text-xs uppercase text-slate-500"><tr><th className="w-8 px-3 py-2">{driveId && <input type="checkbox" aria-label="Select all" checked={list.length > 0 && list.every((c) => sel.has(c.id))} onChange={() => setSel(list.every((c) => sel.has(c.id)) ? new Set() : new Set(list.map((c) => c.id)))} />}</th><th className="px-3 py-2">#</th><th className="px-3 py-2">Candidate</th><th className="px-3 py-2">Stage</th><th className="px-3 py-2">Interviewer</th><th className="px-3 py-2 text-right">Actions</th></tr></thead>
      <tbody className="divide-y divide-slate-100">{list.map(renderRow)}</tbody>
    </table>
  )
  const renderRow = (c) => (
    <tr key={c.id} className={`hover:bg-slate-50 ${sel.has(c.id) ? 'bg-indigo-50/50' : ''}`}>
      <td className="px-3 py-2"><input type="checkbox" aria-label={`Select ${c.full_name}`} checked={sel.has(c.id)} onChange={() => toggle(c.id)} /></td>
      <td className="px-3 py-2 tabular-nums text-slate-400">{c.queue_number ?? ''}</td>
      <td className="px-3 py-2"><button className="text-left font-medium text-slate-900 hover:text-indigo-700" onClick={() => setOpen(c.id)}>{c.full_name}</button>
        <div className="text-xs text-slate-500">{[c.email, c.phone].filter(Boolean).join(' · ')}</div></td>
      <td className="px-3 py-2"><StageBadge stage={c.stage} />{c.interview_completed_at && !c.has_feedback && <span className="ml-1 text-xs text-rose-600">feedback due</span>}</td>
      <td className="px-3 py-2">
        <select className="input !py-1 !text-xs" value={c.interviewer_id || ''} onChange={(e) => assign.mutate({ id: c.id, interviewer_id: e.target.value })} aria-label="Interviewer">
          <option value="">Unassigned</option>{activeIvs.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select></td>
      <td className="px-3 py-2"><div className="flex justify-end gap-1.5">
        {(NEXT[c.stage] || []).map(([to, label0]) => { const label = to === 'checked_in' && autoQueue ? 'Check in & queue' : label0; return (
          <Button key={to} size="sm" variant={to === 'rejected' ? 'danger' : 'secondary'} disabled={to === 'in_interview' && !c.interviewer_id} title={to === 'in_interview' && !c.interviewer_id ? 'Assign an interviewer first' : undefined}
            loading={move.isPending && move.variables?.id === c.id && move.variables?.stage === to} onClick={() => move.mutate({ id: c.id, stage: to })}>{label}</Button>) })}
        {c.interview_completed_at && !c.has_feedback && <Button size="sm" onClick={() => setOpen(c.id)}>Feedback</Button>}
        {CAN_NO_SHOW.has(c.stage) && <Button size="sm" variant="ghost" onClick={() => move.mutate({ id: c.id, stage: 'no_show' })}>No show</Button>}
        <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => askDelete([c.id], c.full_name)} aria-label={`Delete ${c.full_name}`}><Trash2 className="h-3.5 w-3.5" /></Button>
      </div></td>
    </tr>
  )

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[180px] flex-1"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" /><input className="input !pl-8" placeholder="Search name, email or phone" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {!driveId && <select className="input !w-auto" value={driveFilter} onChange={(e) => setDriveFilter(e.target.value)} aria-label="Hiring drive"><option value="">All drives</option>{(drives.data || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>}
        <select className="input !w-auto" value={stage} onChange={(e) => setStage(e.target.value)}><option value="">All stages</option>{Object.entries(STAGE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={pendingFb} onChange={(e) => setPendingFb(e.target.checked)} /> Pending feedback</label>
      </div>
      {error && <Alert>{error}</Alert>}
      {sel.size > 0 && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
          <span>{sel.size} selected</span>
          <div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => setSel(new Set())}>Clear</Button>
            <Button size="sm" variant="danger" loading={remove.isPending} onClick={() => askDelete([...sel], `${sel.size} candidate${sel.size > 1 ? 's' : ''}`)}>Delete selected</Button></div>
        </div>)}
      {list.isLoading ? <Spinner /> : !rows.length ? <Empty>No candidates match.</Empty> : driveId ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">{renderTable(rows)}</div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => {
            const shut = collapsed.has(g.id); const ids = g.rows.map((c) => c.id); const all = ids.every((id) => sel.has(id))
            const count = (f) => g.rows.filter(f).length
            const stats = [[count((c) => c.stage === 'registered'), 'registered'], [count((c) => c.stage === 'waiting'), 'waiting'], [count((c) => c.stage === 'in_interview'), 'in interview'],
              [count((c) => c.interview_completed_at), 'interviewed'], [count((c) => c.interview_completed_at && !c.has_feedback), 'feedback due']].filter(([n]) => n > 0)
            return (
              <section key={g.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white" aria-label={`Drive ${g.name}`}>
                <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-100 bg-slate-50 px-3 py-2.5">
                  <button className="rounded p-0.5 hover:bg-slate-200" aria-label={shut ? `Expand ${g.name}` : `Collapse ${g.name}`} aria-expanded={!shut} onClick={() => setCollapsed((c) => { const n = new Set(c); n.has(g.id) ? n.delete(g.id) : n.add(g.id); return n })}>
                    {shut ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button>
                  <input type="checkbox" aria-label={`Select all in ${g.name}`} checked={all} onChange={() => setSel((s) => { const n = new Set(s); ids.forEach((id) => (all ? n.delete(id) : n.add(id))); return n })} />
                  <Link to={`/drives/${g.id}`} className="font-semibold text-slate-900 hover:text-indigo-700">{g.name}</Link>
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200">{g.rows.length} candidate{g.rows.length > 1 ? 's' : ''}</span>
                  <span className="text-xs text-slate-500">{stats.map(([n, l]) => `${n} ${l}`).join(' · ')}</span>
                  {g.date && <span className="ml-auto text-xs text-slate-400">{g.date}</span>}
                </header>
                {!shut && <div className="overflow-x-auto">{renderTable(g.rows)}</div>}
              </section>)
          })}
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

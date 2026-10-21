import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { get, post, patch } from '../lib/api.js'
import { Alert, Badge, Button, Card, Empty, Field } from '../components/ui.jsx'

/** The same live numbers on the list cards and the detail page. */
export function InterviewerStats({ i }) {
  const items = [[i.assigned, 'assigned'], [i.waiting, 'waiting'], [i.in_interview, 'in interview'], [i.interviewed, 'interviewed'], [i.feedback_due, 'feedback due', i.feedback_due > 0]]
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {items.map(([n, label, warn]) => <span key={label} className={warn ? 'text-rose-600' : 'text-slate-700'}><b className="tabular-nums">{n}</b> {label}</span>)}
    </div>
  )
}

export default function Interviewers() {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ['interviewers'], queryFn: () => get('/interviewers'), refetchInterval: 10000 })
  const [f, setF] = useState({ name: '', email: '' }); const [error, setError] = useState('')
  const add = useMutation({ mutationFn: () => post('/interviewers', { name: f.name, email: f.email || null }), onSuccess: () => { setF({ name: '', email: '' }); setError(''); qc.invalidateQueries({ queryKey: ['interviewers'] }) }, onError: (e) => setError(e.message) })
  const toggle = useMutation({ mutationFn: (i) => patch(`/interviewers/${i.id}`, { active: !i.active }), onSuccess: () => qc.invalidateQueries({ queryKey: ['interviewers'] }) })
  return (
    <div className="space-y-4">
      <div><h1 className="text-2xl font-semibold">Interviewers</h1><p className="text-sm text-slate-500">Your panel. Open an interviewer to see everyone assigned to them. An email lets HireRelay prepare pending-feedback reminders.</p></div>
      <Card title="Add interviewer">
        <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); add.mutate() }}>
          <Field label="Name"><input className="input" required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Email"><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Button loading={add.isPending}>Add</Button>
        </form>{error && <div className="mt-3"><Alert>{error}</Alert></div>}
      </Card>
      {!list.data?.length ? <Card><Empty>No interviewers yet. Add your first panelist above.</Empty></Card> : (
        <div className="grid gap-3 md:grid-cols-2">{list.data.map((i) => (
          <Link key={i.id} to={`/interviewers/${i.id}`} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-indigo-300">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0"><h3 className="truncate font-semibold">{i.name}</h3><p className="truncate text-sm text-slate-500">{i.email || 'no email'}</p></div>
              <Badge tone={i.active ? 'green' : 'slate'}>{i.active ? 'Active' : 'Inactive'}</Badge>
            </div>
            <div className="mt-3"><InterviewerStats i={i} /></div>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs text-indigo-600">View candidates →</span>
              <Button size="sm" variant="secondary" onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle.mutate(i) }}>{i.active ? 'Deactivate' : 'Activate'}</Button>
            </div>
          </Link>))}</div>)}
    </div>
  )
}

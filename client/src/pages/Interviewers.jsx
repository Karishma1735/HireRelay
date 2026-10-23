import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { get, post, patch } from '../lib/api.js'
import { Alert, Badge, Button, Card, Empty, Field } from '../components/ui.jsx'

const timeOf = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
/** What an interviewer's availability means right now, as a badge. */
export function AvailabilityBadge({ i }) {
  if (!i.active) return <Badge>Inactive</Badge>
  if (i.availability_state === 'on_break') return <Badge tone="amber">On a break</Badge>
  if (i.availability_state === 'left') return <Badge tone="red">Left at {timeOf(i.available_until)}</Badge>
  return <Badge tone="green">{i.available_until ? `Available until ${timeOf(i.available_until)}` : 'Available'}</Badge>
}

/** Break, leaving time and the most candidates per drive. Assignments to someone unavailable or full ask HR to confirm. */
export function AvailabilityPanel({ i }) {
  const qc = useQueryClient(); const [error, setError] = useState(''); const [cap, setCap] = useState(i.capacity ?? '')
  const save = useMutation({
    mutationFn: (body) => patch(`/interviewers/${i.id}`, body),
    onSuccess: () => { setError(''); qc.invalidateQueries({ queryKey: ['interviewers'] }); qc.invalidateQueries({ queryKey: ['interviewer', i.id] }); qc.invalidateQueries({ queryKey: ['dashboard'] }) },
    onError: (e) => setError(e.message)
  })
  const leaveAt = (hhmm) => { if (!hhmm) return save.mutate({ available_until: null }); const [h, m] = hhmm.split(':').map(Number); const d = new Date(); d.setHours(h, m, 0, 0); save.mutate({ available_until: d.toISOString() }) }
  const hhmm = i.available_until ? new Date(i.available_until).toTimeString().slice(0, 5) : ''
  const saveCap = () => { const n = cap === '' ? null : Number(cap); if (n !== (i.capacity ?? null)) save.mutate({ capacity: n }) }
  return (
    <Card title="Availability and capacity" action={<AvailabilityBadge i={i} />}>
      <div className="grid gap-4 sm:grid-cols-3">
        <div><span className="label">Break</span>
          <Button variant={i.availability === 'on_break' ? 'primary' : 'secondary'} loading={save.isPending} onClick={() => save.mutate({ availability: i.availability === 'on_break' ? 'available' : 'on_break' })}>{i.availability === 'on_break' ? 'Back from break' : 'Start a break'}</Button>
          <p className="mt-1 text-xs text-slate-500">{i.availability === 'on_break' ? 'No new candidates are suggested or assigned.' : 'Pauses new assignments until you end it.'}</p></div>
        <Field label="Leaving at"><div className="flex gap-2"><input className="input" type="time" value={hhmm} onChange={(e) => leaveAt(e.target.value)} aria-label="Leaving at" />
          {i.available_until && <Button variant="ghost" onClick={() => leaveAt('')}>Clear</Button>}</div>
          <p className="mt-1 text-xs text-slate-500">After this time today they count as gone.</p></Field>
        <Field label="Most candidates per drive"><input className="input" type="number" min="1" max="500" placeholder="No limit" value={cap} onChange={(e) => setCap(e.target.value)} onBlur={saveCap} aria-label="Most candidates per drive" />
          <p className="mt-1 text-xs text-slate-500">Counts everyone they interview in a drive, across rounds.</p></Field>
      </div>
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
    </Card>
  )
}

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
  const pause = useMutation({ mutationFn: (i) => patch(`/interviewers/${i.id}`, { availability: i.availability === 'on_break' ? 'available' : 'on_break' }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['interviewers'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }) } })
  return (
    <div className="space-y-4">
      <div><h1 className="text-[24px] font-semibold tracking-tight">Interviewers</h1><p className="text-sm text-slate-500">Your panel. Open an interviewer to see everyone assigned to them. An email lets HireRelay prepare pending-feedback reminders.</p></div>
      <Card title="Add interviewer">
        <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); add.mutate() }}>
          <Field label="Name"><input className="input" required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Email"><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Button loading={add.isPending}>Add</Button>
        </form>{error && <div className="mt-3"><Alert>{error}</Alert></div>}
      </Card>
      {!list.data?.length ? <Card><Empty>No interviewers yet. Add your first panelist above.</Empty></Card> : (
        <div className="grid gap-3 md:grid-cols-2">{list.data.map((i) => (
          <Link key={i.id} to={`/interviewers/${i.id}`} className="rounded-[10px] border border-slate-200 bg-white p-4 shadow-card transition hover:border-brand-300">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0"><h3 className="truncate font-semibold">{i.name}</h3><p className="truncate text-sm text-slate-500">{i.email || 'no email'}</p></div>
              <AvailabilityBadge i={i} />
            </div>
            <div className="mt-3"><InterviewerStats i={i} />{i.capacity && <p className="mt-1 text-xs text-slate-500">Limit: {i.capacity} candidates per drive</p>}</div>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs text-brand-600">View candidates →</span>
              <div className="flex gap-1.5">
                {i.active && <Button size="sm" variant="secondary" onClick={(e) => { e.preventDefault(); e.stopPropagation(); pause.mutate(i) }}>{i.availability === 'on_break' ? 'Back from break' : 'Break'}</Button>}
                <Button size="sm" variant="secondary" onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle.mutate(i) }}>{i.active ? 'Deactivate' : 'Activate'}</Button></div>
            </div>
          </Link>))}</div>)}
    </div>
  )
}

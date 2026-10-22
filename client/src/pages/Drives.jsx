import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { get, post } from '../lib/api.js'
import { Alert, Badge, Button, Card, Empty, Field, Modal } from '../components/ui.jsx'

/** "Technical, HR, Manager" -> ["Technical", "HR", "Manager"]. One name or none means a single round. */
export const parseRounds = (text) => String(text || '').split(',').map((x) => x.trim()).filter(Boolean)

export default function Drives() {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ['drives'], queryFn: () => get('/drives'), refetchInterval: 10000 })
  const [open, setOpen] = useState(false); const [f, setF] = useState({ name: '', role_title: '', venue: '', drive_date: '', rounds: '' }); const [error, setError] = useState('')
  const create = useMutation({
    mutationFn: () => post('/drives', { ...Object.fromEntries(Object.entries(f).filter(([k]) => k !== 'rounds').map(([k, v]) => [k, v || null])), rounds: parseRounds(f.rounds) }),
    onSuccess: () => { setOpen(false); setF({ name: '', role_title: '', venue: '', drive_date: '', rounds: '' }); qc.invalidateQueries({ queryKey: ['drives'] }) }, onError: (e) => setError(e.message)
  })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><div><h1 className="text-2xl font-semibold">Hiring drives</h1><p className="text-sm text-slate-500">Each drive gets its own shareable registration form.</p></div><Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New drive</Button></div>
      {!list.data?.length ? <Card><Empty>No drives yet. Create one to start collecting candidates.</Empty></Card> : (
        <div className="grid gap-3 md:grid-cols-2">{list.data.map((d) => (
          <Link key={d.id} to={`/drives/${d.id}`} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-indigo-300">
            <div className="flex items-start justify-between gap-2"><h3 className="font-semibold">{d.name}</h3><Badge tone={d.status === 'active' ? 'green' : 'slate'}>{d.status}</Badge></div>
            <p className="mt-0.5 text-sm text-slate-500">{[d.role_title, d.venue, d.drive_date].filter(Boolean).join(' · ') || 'No details yet'}</p>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm"><span><b className="tabular-nums">{d.candidate_count}</b> candidates</span>{d.rounds?.length > 1 && <span>{d.rounds.length} rounds</span>}<span><b className="tabular-nums">{d.checked_in_count}</b> checked in</span>{d.google_form_connected && <Badge tone="indigo">Google Form synced</Badge>}</div>
          </Link>))}</div>)}
      {open && <Modal title="New hiring drive" onClose={() => setOpen(false)}>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); setError(''); create.mutate() }}>
          <Field label="Drive name *"><input className="input" required minLength={2} value={f.name} onChange={set('name')} placeholder="Customer Support Walk-in — Pune" /></Field>
          <Field label="Role"><input className="input" value={f.role_title} onChange={set('role_title')} /></Field>
          <Field label="Venue"><input className="input" value={f.venue} onChange={set('venue')} /></Field>
          <Field label="Date"><input className="input" type="date" value={f.drive_date} onChange={set('drive_date')} /></Field>
          <Field label="Interview rounds (optional)"><input className="input" value={f.rounds} onChange={set('rounds')} placeholder="Technical, HR, Manager" />
            <span className="mt-1 block text-xs text-slate-500">Leave blank for one interview. With several, candidates advance round by round, each with its own interviewer and feedback.</span></Field>
          {error && <Alert>{error}</Alert>}<Button className="w-full" loading={create.isPending}>Create drive</Button>
        </form></Modal>}
    </div>
  )
}

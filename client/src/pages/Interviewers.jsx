import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { get, post, patch } from '../lib/api.js'
import { Alert, Badge, Button, Card, Empty, Field } from '../components/ui.jsx'

export default function Interviewers() {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ['interviewers'], queryFn: () => get('/interviewers') })
  const [f, setF] = useState({ name: '', email: '' }); const [error, setError] = useState('')
  const add = useMutation({ mutationFn: () => post('/interviewers', { name: f.name, email: f.email || null }), onSuccess: () => { setF({ name: '', email: '' }); setError(''); qc.invalidateQueries({ queryKey: ['interviewers'] }) }, onError: (e) => setError(e.message) })
  const toggle = useMutation({ mutationFn: (i) => patch(`/interviewers/${i.id}`, { active: !i.active }), onSuccess: () => qc.invalidateQueries({ queryKey: ['interviewers'] }) })
  return (
    <div className="space-y-4">
      <div><h1 className="text-2xl font-semibold">Interviewers</h1><p className="text-sm text-slate-500">Add the panel. An email lets HireRelay prepare pending-feedback reminders for them.</p></div>
      <Card title="Add interviewer">
        <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); add.mutate() }}>
          <Field label="Name"><input className="input" required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Email"><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Button loading={add.isPending}>Add</Button>
        </form>{error && <div className="mt-3"><Alert>{error}</Alert></div>}
      </Card>
      <Card title="Panel">
        {!list.data?.length ? <Empty>No interviewers yet.</Empty> : (
          <ul className="divide-y divide-slate-100 text-sm">{list.data.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-2 py-2.5"><div><div className="font-medium">{i.name}</div><div className="text-xs text-slate-500">{i.email || 'no email'}{i.in_interview > 0 && ` · ${i.in_interview} in interview now`}</div></div>
              <div className="flex items-center gap-2">{i.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}<Button size="sm" variant="secondary" onClick={() => toggle.mutate(i)}>{i.active ? 'Deactivate' : 'Activate'}</Button></div></li>))}</ul>)}
      </Card>
    </div>
  )
}

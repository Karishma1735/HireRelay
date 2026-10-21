import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Check, Plus } from 'lucide-react'
import { get, post, patch, del } from '../lib/api.js'
import CandidateTable from '../components/CandidateTable.jsx'
import { Alert, Badge, Button, Card, Field, Modal, Spinner } from '../components/ui.jsx'
import { ago } from '../lib/format.js'

export default function DriveDetail() {
  const { id } = useParams(); const qc = useQueryClient()
  const drive = useQuery({ queryKey: ['drive', id], queryFn: () => get(`/drives/${id}`), refetchInterval: 10000 })
  const [copied, setCopied] = useState(false); const [adding, setAdding] = useState(false)
  const status = useMutation({ mutationFn: (s) => patch(`/drives/${id}`, { status: s }), onSuccess: () => qc.invalidateQueries({ queryKey: ['drive', id] }) })
  if (!drive.data) return <Spinner />
  const d = drive.data; const link = `${window.location.origin}/apply/${d.slug}`
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><Link to="/drives" className="text-xs text-indigo-600">← All drives</Link><h1 className="text-2xl font-semibold">{d.name}</h1>
          <p className="text-sm text-slate-500">{[d.role_title, d.venue, d.drive_date].filter(Boolean).join(' · ')}</p></div>
        <div className="flex gap-2"><Button variant="secondary" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add candidate</Button>
          <Button variant="secondary" onClick={() => status.mutate(d.status === 'active' ? 'closed' : 'active')}>{d.status === 'active' ? 'Close registration' : 'Reopen registration'}</Button></div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Registration form link" action={<Badge tone={d.status === 'active' ? 'green' : 'slate'}>{d.status === 'active' ? 'Open' : 'Closed'}</Badge>}>
          <p className="mb-2 text-sm text-slate-600">Share this link or QR with walk-in candidates. Submissions appear instantly and are de-duplicated by email and phone.</p>
          <div className="flex gap-2"><input readOnly className="input font-mono text-xs" value={link} onFocus={(e) => e.target.select()} />
            <Button variant="secondary" onClick={() => { navigator.clipboard?.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500) }}>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</Button></div>
        </Card>
        <GoogleFormCard drive={d} />
      </div>
      <CandidateTable driveId={d.id} />
      {adding && <AddCandidate driveId={d.id} onClose={() => { setAdding(false); qc.invalidateQueries({ queryKey: ['candidates'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }) }} />}
    </div>
  )
}

function GoogleFormCard({ drive }) {
  const qc = useQueryClient()
  const vs = useQuery({ queryKey: ['vs-status'], queryFn: () => get('/viasocket/status') })
  const forms = vs.data?.apps.find((a) => a.name === 'Google Forms')
  const sub = drive.google_form_subscription
  const [formId, setFormId] = useState(''); const [error, setError] = useState('')
  const options = useQuery({ queryKey: ['vs-forms'], queryFn: () => get('/viasocket/forms'), enabled: !!forms?.connected && !sub, retry: false })
  const done = () => { qc.invalidateQueries({ queryKey: ['drive', drive.id] }); qc.invalidateQueries({ queryKey: ['drives'] }) }
  const connect = useMutation({ mutationFn: () => post(`/viasocket/drives/${drive.id}/google-form`, { form_id: formId }), onSuccess: () => { setError(''); done() }, onError: (e) => setError(e.message) })
  const disconnect = useMutation({ mutationFn: () => del(`/viasocket/drives/${drive.id}/google-form`), onSuccess: done, onError: (e) => setError(e.message) })
  const [imported, setImported] = useState(null)
  const importLatest = useMutation({
    mutationFn: () => post(`/viasocket/drives/${drive.id}/google-form/import-latest`),
    onSuccess: (r) => { setError(''); setImported(r); qc.invalidateQueries({ queryKey: ['candidates'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); done() },
    onError: (e) => { setImported(null); setError(e.message) }
  })
  const runs = useMutation({ mutationFn: () => get(`/viasocket/drives/${drive.id}/google-form/runs`), onError: (e) => setError(e.message) })
  const sample = useMutation({ mutationFn: () => get(`/viasocket/drives/${drive.id}/google-form/sample`), onError: (e) => setError(e.message) })
  return (
    <Card title="Google Form via viaSocket" action={sub ? <Badge tone="green">Live</Badge> : <Badge>Not connected</Badge>}>
      {vs.isLoading ? <Spinner /> : !vs.data.configured ? (
        <Alert tone="warn">viaSocket is not configured yet (missing {vs.data.missing.join(', ')}). See <Link className="underline" to="/integrations">Integrations</Link>.</Alert>
      ) : !forms?.connected ? (
        <p className="text-sm text-slate-600">Connect your Google account on <Link className="font-medium text-indigo-600" to="/integrations">Integrations</Link> to sync a Google Form into this drive.</p>
      ) : sub ? (
        <div className="space-y-3 text-sm">
          <p className="text-slate-600">New responses appear here <b>automatically</b>. HireRelay checks your form every 30 seconds, and viaSocket also delivers them directly. Duplicates are ignored and interview status is never overwritten. Only a response sent <i>before</i> syncing started needs <b>Import latest response</b>.</p>
          <p className={`rounded-lg px-3 py-2 text-xs ${drive.last_form_event ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'}`}>
            {drive.last_form_event ? <>Last response received {ago(drive.last_form_event.created_at)} ({drive.last_form_event.outcome === 'created' ? 'added as a new candidate' : drive.last_form_event.outcome}).</> : <>No response has arrived yet. Submit a response to your form, then check back here, or import the latest existing one.</>}</p>
          <div className="flex flex-wrap gap-2"><Button size="sm" loading={importLatest.isPending} onClick={() => importLatest.mutate()}>Import latest response</Button><Button size="sm" variant="secondary" loading={sample.isPending} onClick={() => sample.mutate()}>Preview mapping</Button><Button size="sm" variant="secondary" loading={runs.isPending} onClick={() => runs.mutate()}>Delivery log</Button><Button size="sm" variant="danger" loading={disconnect.isPending} onClick={() => disconnect.mutate()}>Disconnect</Button></div>
          {runs.data && (runs.data.length === 0 ? <p className="rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600">viaSocket has not run this form's trigger yet. That is normal until a new response is submitted; HireRelay's own 30-second check still picks it up.</p> : (
            <ul className="space-y-1 rounded-lg bg-slate-50 p-2.5 text-xs">{runs.data.map((r, i) => <li key={i} className="flex flex-wrap items-baseline gap-x-2"><Badge tone={r.status === 'success' ? 'green' : 'red'}>{r.status}</Badge><span className="text-slate-500">{ago(r.at)}</span>{r.message && <span className="break-all text-slate-700">{r.message}</span>}</li>)}</ul>))}
          {imported && <Alert tone="ok">{imported.outcome === 'created' ? <>Added <b>{imported.name}</b> to this drive.</> : <>That response is already in this drive{imported.name ? <> (<b>{imported.name}</b>)</> : ''}, so nothing was added.</>}</Alert>}
          {sample.data && <div className="rounded-lg bg-slate-50 p-3 text-xs"><div className="mb-1 font-medium">How the latest response would map (preview only, nothing is added):</div>
            <pre className="overflow-x-auto whitespace-pre-wrap">{JSON.stringify(sample.data.mapped, null, 2)}</pre>
            <div className="mt-2 font-medium">Form keys received:</div><div className="text-slate-600">{Object.keys(sample.data.event).join(', ') || 'none'}</div>
            {sample.data.note && <div className="mt-1 text-amber-700">{sample.data.note}</div>}</div>}
        </div>
      ) : (
        <div className="space-y-3">
          {options.isError ? <Alert>{options.error.message}</Alert> : (
            <Field label="Choose a form from your Google account">
              <select className="input" value={formId} onChange={(e) => setFormId(e.target.value)} disabled={options.isLoading}>
                <option value="">{options.isLoading ? 'Loading your forms…' : 'Select a form'}</option>{options.data?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select></Field>)}
          <Button disabled={!formId} loading={connect.isPending} onClick={() => connect.mutate()}>Start syncing responses</Button>
        </div>
      )}
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
    </Card>
  )
}

function AddCandidate({ driveId, onClose }) {
  const [f, setF] = useState({ full_name: '', email: '', phone: '', role_applied: '' }); const [error, setError] = useState('')
  const add = useMutation({ mutationFn: () => post('/candidates', { drive_id: driveId, ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v || null])) }), onSuccess: onClose, onError: (e) => setError(e.message) })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  return (
    <Modal title="Add candidate" onClose={onClose}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); setError(''); add.mutate() }}>
        <Field label="Full name *"><input className="input" required value={f.full_name} onChange={set('full_name')} /></Field>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Email"><input className="input" type="email" value={f.email} onChange={set('email')} /></Field><Field label="Phone"><input className="input" value={f.phone} onChange={set('phone')} /></Field></div>
        <Field label="Role"><input className="input" value={f.role_applied} onChange={set('role_applied')} /></Field>
        {error && <Alert>{error}</Alert>}<Button className="w-full" loading={add.isPending}>Add candidate</Button>
      </form>
    </Modal>
  )
}

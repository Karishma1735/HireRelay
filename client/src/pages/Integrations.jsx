import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, RefreshCw } from 'lucide-react'
import { get, post, put, del } from '../lib/api.js'
import { Alert, Badge, Button, Card, Field, Spinner } from '../components/ui.jsx'

const loadScript = (src, id) => new Promise((resolve, reject) => {
  if (document.getElementById(id)) return resolve()
  const s = document.createElement('script'); s.id = id; s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(`Could not load ${src}`))
  document.head.appendChild(s)
})

export default function Integrations() {
  const qc = useQueryClient()
  const vs = useQuery({ queryKey: ['vs-status'], queryFn: () => get('/viasocket/status'), refetchInterval: 15000 })
  const [token, setToken] = useState(null); const [error, setError] = useState(''); const [scriptReady, setScriptReady] = useState(false)
  const clicked = useRef(null)
  const configured = vs.data?.configured

  // The token is fetched before any click, so the popup opens inside the click handler (no popup blocker).
  useEffect(() => {
    if (!configured) return
    get('/viasocket/token').then((r) => setToken(r.token)).catch((e) => setError(e.message))
    loadScript('https://flow.viasocket.com/connect.js', 'viasocket-connect-script').then(() => setScriptReady(true)).catch((e) => setError(e.message))
  }, [configured])

  const connected = useMutation({
    mutationFn: (b) => post('/viasocket/connected', b),
    onSuccess: () => { setError(''); qc.invalidateQueries({ queryKey: ['vs-status'] }) }, onError: (e) => setError(e.message)
  })
  useEffect(() => {
    const onMsg = (event) => {
      const d = event.data
      if (d?.type === 'viasocket_connection_success') connected.mutate({ serviceId: d.serviceId || clicked.current, authId: d.data.id })
      else if (d?.type === 'viasocket_connection_error') setError(d.error?.message || 'The connection failed')
      // viasocket_connection_closed means "nothing yet", not a result: a success can still follow.
    }
    window.addEventListener('message', onMsg); return () => window.removeEventListener('message', onMsg)
  }, [connected])

  const open = (app, extra = {}) => {
    clicked.current = app.service_id
    const actionIds = { 'Google Forms': [vs.data.action_ids.forms_trigger], Gmail: [vs.data.action_ids.gmail_send] }[app.name]
    window.openViasocketConnection(token, app.service_id, { filteredActions: actionIds, skipActionSelection: true, ...extra })
  }
  const disconnect = useMutation({ mutationFn: (id) => del(`/viasocket/connections/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['vs-status'] }), onError: (e) => setError(e.message) })

  if (vs.isLoading) return <Spinner />
  return (
    <div className="space-y-4">
      <div><h1 className="text-2xl font-semibold">Integrations</h1><p className="text-sm text-slate-500">HireRelay runs on viaSocket: Google Forms intake, Gmail delivery, the AI agent and every other app you connect below.</p></div>
      {!configured && <Alert tone="warn"><b>viaSocket is not configured.</b> Missing: <code>{vs.data.missing.join(', ')}</code>. Open <b>viaSocket → Integrations → the embed → Install Code</b> (click <b>Create embed</b> if there is none), copy the values into <code>.env</code> and restart the server. Connecting apps, the AI agent and sending emails stay off until then.</Alert>}
      {vs.data.live_error && <Alert>{vs.data.live_error}</Alert>}
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-4 md:grid-cols-2">
        {vs.data.apps.map((app) => (
          <Card key={app.service_id} title={<span className="flex items-center gap-2"><img src={app.icon} alt="" width="20" height="20" className="h-5 w-5 object-contain" />{app.name}</span>}
            action={app.connected ? (app.expired ? <Badge tone="amber">Expired</Badge> : <Badge tone="green">Connected</Badge>) : <Badge>Not connected</Badge>}>
            <p className="mb-3 text-sm text-slate-600">{app.name === 'Google Forms' ? 'Syncs each new form response into a hiring drive, through a viaSocket handler.' : 'Sends approved confirmations and reminders from your own Gmail address.'}</p>
            <div className="flex flex-wrap gap-2">
              {!app.connected && <Button disabled={!configured || !token || !scriptReady} onClick={() => open(app)}><img src={app.icon} alt="" className="h-4 w-4 rounded-sm bg-white object-contain" /> Connect {app.name}</Button>}
              {app.connected && app.expired && <Button onClick={() => open(app, { authId: app.auth_id })}><RefreshCw className="h-4 w-4" /> Reconnect</Button>}
              {app.connected && <Button variant="danger" loading={disconnect.isPending} onClick={() => confirm(`Disconnect ${app.name}? Flows built on it stop.`) && disconnect.mutate(app.service_id)}>Disconnect</Button>}
            </div>
            {app.name === 'Gmail' && app.connected && !app.expired && <SenderPicker current={app.config?.from} />}
            {app.name === 'Google Forms' && app.connected && !app.expired && <DriveForms />}
          </Card>))}
      </div>
      <Card title="Connect any other app (prebuilt viaSocket UI)">
        <p className="mb-3 text-sm text-slate-600">Browse 2,300+ apps and build your own automations — Slack, Sheets, WhatsApp, CRMs. Everything you connect here is yours, isolated from other HR users.</p>
        {configured && token ? <PrebuiltUI token={token} /> : <p className="text-sm text-slate-500">Available once viaSocket is configured.</p>}
      </Card>
    </div>
  )
}

function SenderPicker({ current }) {
  const qc = useQueryClient(); const [value, setValue] = useState(current || ''); const [error, setError] = useState('')
  const options = useQuery({ queryKey: ['vs-senders'], queryFn: () => get('/viasocket/gmail/senders'), retry: false })
  const save = useMutation({ mutationFn: () => put('/viasocket/gmail/sender', { from: value }), onSuccess: () => { setError(''); qc.invalidateQueries({ queryKey: ['vs-status'] }) }, onError: (e) => setError(e.message) })
  return (
    <div className="mt-4 space-y-2 border-t pt-3">
      <Field label="Send emails from">
        <select className="input" value={value} onChange={(e) => setValue(e.target.value)} disabled={options.isLoading}>
          <option value="">{options.isLoading ? 'Loading your addresses…' : 'Choose an address'}</option>{options.data?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select></Field>
      {options.isError && <Alert>{options.error.message}</Alert>}{error && <Alert>{error}</Alert>}
      <div className="flex items-center gap-2"><Button size="sm" disabled={!value || value === current} loading={save.isPending} onClick={() => save.mutate()}>Save sender</Button>
        {current && value === current && <span className="flex items-center gap-1 text-xs text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Emails will be sent from this address</span>}</div>
    </div>
  )
}

function PrebuiltUI({ token }) {
  const ref = useRef(null); const [err, setErr] = useState('')
  useEffect(() => {
    let embed
    loadScript('https://embed.viasocket.com/prod-embedcomponent.js', 'viasocket-embed-script').then(() => {
      embed = window.viaSocket.mount({ embedToken: token, parent: ref.current, config: {} })
      embed.on?.('flow', () => {}) // flows live on viaSocket; HireRelay does not mirror them
    }).catch((e) => setErr(e.message))
    return () => { try { embed?.destroy?.() } catch { /* already gone */ } }
  }, [token])
  return <>{err && <Alert>{err}</Alert>}<div ref={ref} style={{ height: 640 }} className="overflow-hidden rounded-lg border border-slate-200" /></>
}

/** Each hiring drive is fed by one Google Form, chosen from the user's own account. */
function DriveForms() {
  const qc = useQueryClient(); const [error, setError] = useState(''); const [picked, setPicked] = useState({})
  const drives = useQuery({ queryKey: ['drives'], queryFn: () => get('/drives') })
  const forms = useQuery({ queryKey: ['vs-forms'], queryFn: () => get('/viasocket/forms'), retry: false })
  const done = () => { setError(''); qc.invalidateQueries({ queryKey: ['drives'] }); qc.invalidateQueries({ queryKey: ['drive'] }) }
  const start = useMutation({ mutationFn: (driveId) => post(`/viasocket/drives/${driveId}/google-form`, { form_id: picked[driveId] }), onSuccess: done, onError: (e) => setError(e.message) })
  const stop = useMutation({ mutationFn: (driveId) => del(`/viasocket/drives/${driveId}/google-form`), onSuccess: done, onError: (e) => setError(e.message) })
  return (
    <div className="mt-4 space-y-3 border-t pt-3">
      <div className="text-xs font-medium text-slate-600">Which form feeds which hiring drive</div>
      {drives.isLoading || forms.isLoading ? <p className="text-sm text-slate-500">Loading your drives and forms…</p>
        : forms.isError ? <Alert>{forms.error.message}</Alert>
        : !drives.data?.length ? <p className="text-sm text-slate-600">Create a hiring drive first, then pick its form here. <Link className="font-medium text-indigo-600" to="/drives">Go to drives</Link></p>
        : !forms.data?.length ? <p className="text-sm text-slate-600">No Google Forms found in this Google account. Create a form in Google Forms, then reload this page.</p>
        : drives.data.map((d) => (
          <div key={d.id} className="space-y-1.5 rounded-lg border border-slate-200 p-2.5">
            <div className="flex items-center justify-between gap-2 text-sm"><Link to={`/drives/${d.id}`} className="font-medium hover:text-indigo-700">{d.name}</Link>
              {d.google_form_connected && <Badge tone="green">Syncing</Badge>}</div>
            {d.google_form_connected ? <Button size="sm" variant="danger" loading={stop.isPending && stop.variables === d.id} onClick={() => stop.mutate(d.id)}>Stop syncing</Button> : (
              <div className="flex gap-2">
                <select className="input !py-1.5 !text-sm" value={picked[d.id] || ''} onChange={(e) => setPicked({ ...picked, [d.id]: e.target.value })} aria-label={`Google Form for ${d.name}`}>
                  <option value="">Select a form…</option>{forms.data.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <Button size="sm" disabled={!picked[d.id]} loading={start.isPending && start.variables === d.id} onClick={() => start.mutate(d.id)}>Start syncing</Button>
              </div>)}
          </div>))}
      {error && <Alert>{error}</Alert>}
    </div>
  )
}

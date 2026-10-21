import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { get } from '../lib/api.js'
import { ago, STAGE_LABEL } from '../lib/format.js'
import { Badge, Card, Empty, Spinner, Stat, Alert } from '../components/ui.jsx'

const STAGE_BAR = { registered: 'bg-slate-400', checked_in: 'bg-sky-500', waiting: 'bg-amber-500', in_interview: 'bg-indigo-500', completed: 'bg-emerald-500', selected: 'bg-green-600', rejected: 'bg-rose-500', no_show: 'bg-zinc-400' }

export default function Dashboard() {
  const [driveId, setDriveId] = useState('')
  const drives = useQuery({ queryKey: ['drives'], queryFn: () => get('/drives') })
  const dash = useQuery({ queryKey: ['dashboard', driveId], queryFn: () => get(`/dashboard${driveId ? `?drive_id=${driveId}` : ''}`), refetchInterval: 5000 })
  const m = dash.data?.metrics
  const noDrives = drives.data && drives.data.length === 0
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-slate-500">Live from your database · refreshes every 5s{m?.last_sync && <> · last form sync {ago(m.last_sync.created_at)} ({m.last_sync.source})</>}</p></div>
        <select className="input !w-auto" value={driveId} onChange={(e) => setDriveId(e.target.value)} aria-label="Hiring drive">
          <option value="">All drives</option>{drives.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>
      {noDrives && <Alert tone="warn">No hiring drive yet. <Link className="font-medium underline" to="/drives">Create your first drive</Link> to get a registration link and start collecting candidates.</Alert>}
      {dash.isLoading ? <Spinner /> : dash.isError ? <Alert>{dash.error.message}</Alert> : (<>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Stat label="Total candidates" value={m.total} />
          <Stat label="Registered" value={m.registered} hint="Not yet checked in" />
          <Stat label="Checked in" value={m.checked_in} hint="Arrived at the venue" />
          <Stat label="Waiting" value={m.waiting} tone="text-amber-600" hint="In the queue" />
          <Stat label="Interviews done" value={m.completed} tone="text-emerald-600" />
          <Stat label="Pending feedback" value={m.pending_feedback} tone={m.pending_feedback ? 'text-rose-600' : undefined} />
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Candidate stages" className="lg:col-span-1">
            {m.total === 0 ? <Empty>No candidates yet.</Empty> : (
              <ul className="space-y-2.5">{Object.keys(STAGE_LABEL).filter((s) => m.stages[s]).map((s) => (
                <li key={s}><div className="mb-1 flex justify-between text-xs"><span>{STAGE_LABEL[s]}</span><span className="tabular-nums text-slate-500">{m.stages[s]}</span></div>
                  <div className="h-2 rounded-full bg-slate-100"><div className={`h-2 rounded-full ${STAGE_BAR[s]}`} style={{ width: `${(m.stages[s] / m.total) * 100}%` }} /></div></li>))}</ul>)}
          </Card>
          <Card title="Waiting queue" action={<Link to="/candidates" className="text-xs text-indigo-600">View all</Link>}>
            {dash.data.waiting.length === 0 ? <Empty>Nobody is waiting.</Empty> : (
              <ul className="divide-y divide-slate-100 text-sm">{dash.data.waiting.map((c) => (
                <li key={c.id} className="flex items-center justify-between py-2"><span><b className="mr-2 tabular-nums text-slate-400">#{c.queue_number}</b>{c.full_name}</span><span className="text-xs text-slate-500">{c.interviewer || 'unassigned'}</span></li>))}</ul>)}
          </Card>
          <Card title="Pending feedback" action={<Link to="/candidates?pending_feedback=1" className="text-xs text-indigo-600">View all</Link>}>
            {dash.data.pending_feedback.length === 0 ? <Empty>No feedback is pending.</Empty> : (
              <ul className="divide-y divide-slate-100 text-sm">{dash.data.pending_feedback.map((c) => (
                <li key={c.id} className="flex items-center justify-between py-2"><span>{c.full_name}</span><span className="text-xs text-slate-500">{c.interviewer || 'unassigned'} · {ago(c.interview_completed_at)}</span></li>))}</ul>)}
          </Card>
        </div>
        <Card title="Form synchronisation">
          {dash.data.recent_sync.length === 0 ? <Empty>No submissions received yet.</Empty> : (
            <ul className="divide-y divide-slate-100 text-sm">{dash.data.recent_sync.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 py-2"><span className="truncate">{e.full_name || e.message || 'Submission'} <span className="text-xs text-slate-400">via {e.source}</span></span>
                <span className="flex items-center gap-2"><Badge tone={e.outcome === 'created' ? 'green' : e.outcome === 'duplicate' ? 'amber' : 'red'}>{e.outcome}</Badge><span className="text-xs text-slate-400">{ago(e.created_at)}</span></span></li>))}</ul>)}
        </Card>
      </>)}
    </div>
  )
}

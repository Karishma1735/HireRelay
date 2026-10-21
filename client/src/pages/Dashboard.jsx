import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Users, LogIn, Hourglass, CheckCircle2, ClipboardCheck, Plus, ArrowRight, Check, Clock, Timer, Inbox, Sparkles, CalendarDays, ShieldCheck } from 'lucide-react'
import { get } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { ago } from '../lib/format.js'
import { Alert, Badge, Card, Empty, Spinner } from '../components/ui.jsx'
import { AreaChart, Funnel, LoadBars, RAMP } from '../components/charts.jsx'

const minutesSince = (d) => (d ? Math.max(0, Math.round((Date.now() - new Date(d)) / 60000)) : null)
const hourGreeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening' }
const initials = (name) => String(name || '?').split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('')
const Avatar = ({ name }) => <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-700">{initials(name)}</span>

function Tile({ icon: Icon, label, value, hint, tone = 'indigo', to }) {
  const chip = { indigo: 'bg-indigo-50 text-indigo-600', amber: 'bg-amber-50 text-amber-600', green: 'bg-emerald-50 text-emerald-600', red: 'bg-rose-50 text-rose-600' }[tone]
  const body = (
    <div className="flex h-full flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md">
      <div className="flex items-center gap-2.5">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${chip}`}><Icon className="h-4 w-4" /></span>
        <span className="text-xs font-medium leading-tight text-slate-500">{label}</span>
      </div>
      <div className="text-3xl font-semibold leading-none tabular-nums text-slate-900">{value ?? '—'}</div>
      {hint && <div className="text-xs leading-snug text-slate-500">{hint}</div>}
    </div>)
  return to ? <Link to={to} className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 rounded-2xl">{body}</Link> : body
}

function SetupChecklist({ setup, vs }) {
  const forms = vs?.apps?.find((a) => a.name === 'Google Forms'); const gmail = vs?.apps?.find((a) => a.name === 'Gmail')
  const steps = [
    ['Create your first hiring drive', setup.drives > 0, '/drives'],
    ['Add your interviewers', setup.interviewers > 0, '/interviewers'],
    ['Connect Google Forms', !!forms?.connected, '/integrations'],
    ['Connect Gmail and choose a sender', !!gmail?.connected && !!gmail?.config?.from, '/integrations'],
    ['Receive your first candidate', setup.candidates > 0, '/drives']
  ]
  const done = steps.filter((s) => s[1]).length
  if (done === steps.length) return null
  return (
    <Card title={<span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-indigo-600" /> Get set up · {done} of {steps.length} done</span>}>
      <div className="mb-4 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={steps.length}><div className="h-full rounded-full bg-indigo-600 transition-all" style={{ width: `${(done / steps.length) * 100}%` }} /></div>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {steps.map(([label, ok, to]) => (
          <li key={label}><Link to={to} className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition ${ok ? 'border-emerald-200 bg-emerald-50/50 text-slate-500' : 'border-slate-200 bg-white text-slate-800 hover:border-indigo-300'}`}>
            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${ok ? 'bg-emerald-500 text-white' : 'border border-slate-300'}`}>{ok && <Check className="h-3 w-3" />}</span>
            <span className={ok ? 'line-through' : ''}>{label}</span>{!ok && <ArrowRight className="ml-auto h-4 w-4 text-slate-400" />}</Link></li>))}
      </ul>
    </Card>
  )
}

export default function Dashboard() {
  const { session } = useAuth()
  const [driveId, setDriveId] = useState('')
  const drives = useQuery({ queryKey: ['drives'], queryFn: () => get('/drives') })
  const dash = useQuery({ queryKey: ['dashboard', driveId], queryFn: () => get(`/dashboard${driveId ? `?drive_id=${driveId}` : ''}`), refetchInterval: 5000 })
  const vs = useQuery({ queryKey: ['vs-status'], queryFn: () => get('/viasocket/status'), staleTime: 30000 })
  const d = dash.data; const m = d?.metrics
  const name = (session?.user?.email || '').split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || 'there'
  const today = new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="space-y-5">
      <header className="overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-indigo-600 to-blue-500 p-5 text-white shadow-sm sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="flex items-center gap-1.5 text-sm text-indigo-100"><CalendarDays className="h-4 w-4" /> {today}</p>
            <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">{hourGreeting()}, {name}</h1>
            <p className="mt-1 text-sm text-indigo-100">{m ? (m.total ? <>{m.waiting} waiting · {m.in_interview} in interview · {m.pending_feedback} feedback due</> : 'Your hiring drives will show up here as candidates register.') : 'Loading…'}</p>
          </div>
          <select className="rounded-lg border border-white/30 bg-white/15 px-3 py-2 text-sm text-white backdrop-blur [&>option]:text-slate-900" value={driveId} onChange={(e) => setDriveId(e.target.value)} aria-label="Hiring drive">
            <option value="">All drives</option>{drives.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Link to="/drives" className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3.5 py-2 text-sm font-medium text-indigo-700 shadow-sm hover:bg-indigo-50"><Plus className="h-4 w-4" /> New drive</Link>
          <Link to="/candidates" className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3.5 py-2 text-sm font-medium hover:bg-white/25"><Users className="h-4 w-4" /> Candidates</Link>
          <Link to="/approvals" className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3.5 py-2 text-sm font-medium hover:bg-white/25"><ShieldCheck className="h-4 w-4" /> Approvals{m?.pending_approvals > 0 && <span className="rounded-full bg-amber-400 px-1.5 text-xs font-semibold text-amber-950">{m.pending_approvals}</span>}</Link>
          {m && <span className="ml-auto flex flex-wrap gap-x-4 text-xs text-indigo-100">
            <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> Avg wait now: <b className="text-white">{m.avg_wait_min == null ? '—' : `${m.avg_wait_min} min`}</b></span>
            <span className="flex items-center gap-1"><Timer className="h-3.5 w-3.5" /> Avg interview: <b className="text-white">{m.avg_interview_min == null ? '—' : `${m.avg_interview_min} min`}</b></span></span>}
        </div>
      </header>

      {dash.isLoading ? <Spinner /> : dash.isError ? <Alert>{dash.error.message}</Alert> : (<>
        <SetupChecklist setup={d.setup} vs={vs.data} />

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Tile icon={Users} label="Total candidates" value={m.total} hint="In this selection" to="/candidates" />
          <Tile icon={Inbox} label="Registered" value={m.registered} hint="Not yet checked in" />
          <Tile icon={LogIn} label="Checked in" value={m.checked_in} hint={m.total ? `${Math.round((m.checked_in / m.total) * 100)}% of registered` : 'Arrived at the venue'} />
          <Tile icon={Hourglass} label="Waiting" value={m.waiting} tone="amber" hint="In the queue" />
          <Tile icon={CheckCircle2} label="Interviews done" value={m.completed} tone="green" hint={m.stages.selected ? `${m.stages.selected} selected` : undefined} />
          <Tile icon={ClipboardCheck} label="Pending feedback" value={m.pending_feedback} tone={m.pending_feedback ? 'red' : 'indigo'} hint={m.pending_feedback ? 'Needs attention' : 'All caught up'} to={m.pending_feedback ? '/candidates?pending_feedback=1' : undefined} />
        </div>

        <div className="grid gap-4 lg:grid-cols-5">
          <Card title="Registrations, last 14 days" className="lg:col-span-3">
            {m.total === 0 ? <Empty>No candidates yet. Share a drive&apos;s registration link to see this fill up.</Empty> : <AreaChart data={d.timeline} />}
          </Card>
          <Card title="Hiring funnel" className="lg:col-span-2">
            {m.total === 0 ? <Empty>The funnel appears once candidates register.</Empty> : (
              <Funnel stages={[
                { label: 'Registered', value: m.total, color: RAMP[250] }, { label: 'Checked in', value: m.checked_in, color: RAMP[350] },
                { label: 'Interviewed', value: m.completed, color: RAMP[450] }, { label: 'Selected', value: m.stages.selected || 0, color: RAMP[600] }]} />)}
            {m.total > 0 && <p className="mt-4 border-t border-slate-100 pt-3 text-sm text-slate-600">{m.stages.selected ? <><b className="text-slate-900">{Math.round(((m.stages.selected || 0) / m.total) * 100)}%</b> of registered candidates have been selected so far.</> : m.completed ? <>{m.completed} interviewed, none selected yet.</> : <>{m.checked_in} of {m.total} have arrived. Interviews are next.</>}</p>}
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card title={<span className="flex items-center gap-2">Now interviewing {d.in_interview.length > 0 && <Badge tone="indigo">{d.in_interview.length}</Badge>}</span>}>
            {d.in_interview.length === 0 ? <Empty>No interview is running.</Empty> : (
              <ul className="space-y-2">{d.in_interview.map((c) => (
                <li key={c.id} className="flex items-center gap-3 rounded-xl bg-indigo-50/60 px-3 py-2"><Avatar name={c.full_name} />
                  <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{c.full_name}</div><div className="truncate text-xs text-slate-500">with {c.interviewer || 'no interviewer'}</div></div>
                  <span className="flex items-center gap-1 text-xs font-medium tabular-nums text-indigo-700"><Timer className="h-3.5 w-3.5" />{minutesSince(c.interview_started_at) ?? 0} min</span></li>))}</ul>)}
          </Card>
          <Card title={<span className="flex items-center gap-2">Up next {m.waiting > 0 && <Badge tone="amber">{m.waiting}</Badge>}</span>} action={<Link to="/candidates" className="text-xs text-indigo-600">View all</Link>}>
            {d.waiting.length === 0 ? <Empty>Nobody is waiting.</Empty> : (
              <ul className="space-y-2">{d.waiting.slice(0, 6).map((c) => {
                const wait = minutesSince(c.checked_in_at); const long = wait != null && wait >= 30
                return (
                  <li key={c.id} className="flex items-center gap-3 text-sm"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-50 text-xs font-semibold tabular-nums text-amber-700">#{c.queue_number}</span>
                    <div className="min-w-0 flex-1"><div className="truncate font-medium">{c.full_name}</div><div className="truncate text-xs text-slate-500">{c.interviewer ? `with ${c.interviewer}` : 'no interviewer yet'}</div></div>
                    {wait != null && <span className={`flex items-center gap-1 whitespace-nowrap text-xs tabular-nums ${long ? 'font-medium text-rose-600' : 'text-slate-500'}`}><Clock className="h-3.5 w-3.5" />{wait < 1 ? '<1' : wait} min{long && <span className="sr-only"> (long wait)</span>}</span>}</li>)
              })}{m.waiting > 6 && <li className="pt-1 text-xs text-slate-500">+ {m.waiting - 6} more in the queue</li>}</ul>)}
          </Card>
          <Card title="Interviewer workload" action={<Link to="/interviewers" className="text-xs text-indigo-600">Manage</Link>}>
            {d.interviewer_load.length === 0 ? <Empty>Add interviewers to see their workload.</Empty> : <LoadBars rows={d.interviewer_load} />}
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Pending feedback" action={<Link to="/candidates?pending_feedback=1" className="text-xs text-indigo-600">View all</Link>}>
            {d.pending_feedback.length === 0 ? <Empty>No feedback is pending. Nice.</Empty> : (
              <ul className="space-y-2">{d.pending_feedback.slice(0, 6).map((c) => (
                <li key={c.id} className="flex items-center gap-3 text-sm"><Avatar name={c.full_name} />
                  <div className="min-w-0 flex-1"><div className="truncate font-medium">{c.full_name}</div><div className="truncate text-xs text-slate-500">{c.interviewer ? `${c.interviewer} owes feedback` : 'no interviewer assigned'}</div></div>
                  <span className="whitespace-nowrap text-xs text-rose-600">{ago(c.interview_completed_at)}</span></li>))}</ul>)}
          </Card>
          <Card title="Latest registrations">
            {d.recent_sync.length === 0 ? <Empty>No submissions received yet.</Empty> : (
              <ul className="space-y-2">{d.recent_sync.map((e) => (
                <li key={e.id} className="flex items-center gap-3 text-sm"><Avatar name={e.full_name || e.message} />
                  <div className="min-w-0 flex-1"><div className="truncate font-medium">{e.full_name || e.message || 'Submission'}</div><div className="text-xs text-slate-500">via {e.source === 'google_forms' ? 'Google Form' : e.source === 'form' ? 'registration link' : e.source === 'manual' ? 'added by you' : e.source}</div></div>
                  <Badge tone={e.outcome === 'created' ? 'green' : e.outcome === 'duplicate' ? 'amber' : 'red'}>{e.outcome === 'created' ? 'new' : e.outcome}</Badge><span className="w-14 text-right text-xs text-slate-400">{ago(e.created_at)}</span></li>))}</ul>)}
          </Card>
        </div>
      </>)}
    </div>
  )
}

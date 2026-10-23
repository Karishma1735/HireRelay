import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Users, LogIn, Hourglass, CheckCircle2, ClipboardCheck, Plus, ArrowRight, Check, Clock, Timer, Inbox, Sparkles, CalendarDays, ShieldCheck } from 'lucide-react'
import { get, patch } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { ago } from '../lib/format.js'
import { Alert, Avatar, Badge, Button, Card, Empty, Spinner, Token } from '../components/ui.jsx'
import { AreaChart, Funnel, LoadBars, RAMP } from '../components/charts.jsx'

const minutesSince = (d) => (d ? Math.max(0, Math.round((Date.now() - new Date(d)) / 60000)) : null)
const hourGreeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening' }

const cumulative = (tl) => { let n = 0; return (tl || []).map((x) => (n += x.count)) }
function Spark({ points, color }) {
  if (!points || points.filter((p) => p > 0).length < 3) return null
  const m = Math.max(...points); const n = points.length
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${((i * 100) / (n - 1)).toFixed(1)},${(26 - (p / m) * 22).toFixed(1)}`).join(' ')
  return <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="h-7 w-24" aria-hidden="true"><path d={d} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" /></svg>
}

// The first tile is solid graphite and the second a soft cobalt tint (the "key numbers"); the rest are white.
function Tile({ icon: Icon, label, value, hint, kind = 'plain', to, spark }) {
  const k = { solid: ['bg-ink-800 text-white', 'text-slate-300', '#FFFFFF'], soft: ['bg-brand-50 text-brand-800 ring-1 ring-inset ring-brand-100', 'text-brand-700', '#2447C9'], plain: ['bg-white text-ink-900 shadow-card ring-1 ring-slate-200/90', 'text-slate-500', '#2F5BFF'], warn: ['bg-white text-ink-900 shadow-card ring-1 ring-slate-200/90', 'text-slate-500', '#B45309'] }[kind]
  const body = (
    <div className={`flex h-full flex-col rounded-[10px] p-4 transition ${k[0]} ${to ? 'hover:-translate-y-px hover:shadow-pop' : ''}`}>
      <div className={`flex items-center justify-between text-[13px] ${k[1]}`}>{label}<Icon className="h-4 w-4 opacity-80" /></div>
      <div className="mt-3 flex items-end justify-between gap-2"><span className="text-[30px] font-semibold leading-none tracking-tight tabular-nums">{value ?? '—'}</span><Spark points={spark} color={k[2]} /></div>
      {hint && <div className={`mt-2.5 text-xs ${k[1]}`}>{hint}</div>}
    </div>)
  return to ? <Link to={to} className="block rounded-[10px]">{body}</Link> : body
}

/**
 * Who could be called next: the longest waiter for each interviewer who is free, available and under their limit.
 * Nothing happens until HR presses Assign; the usual emails then go out as for any assignment.
 */
function UpNext({ suggestions }) {
  const qc = useQueryClient(); const [error, setError] = useState('')
  const assign = useMutation({
    mutationFn: ({ s, force }) => patch(`/candidates/${s.candidate.id}/interviewer`, { interviewer_id: s.interviewer.id, ...(force && { force: true }) }),
    onSuccess: () => { setError(''); qc.invalidateQueries({ queryKey: ['dashboard'] }); qc.invalidateQueries({ queryKey: ['candidates'] }); qc.invalidateQueries({ queryKey: ['interviewers'] }) },
    onError: (e, v) => { if (['on_break', 'left', 'inactive', 'full'].includes(e.code) && confirm(`${e.message} Assign anyway?`)) assign.mutate({ ...v, force: true }); else setError(e.message) }
  })
  if (!suggestions?.length) return null
  return (
    <Card title={<span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-brand-600" /> Suggested next</span>}>
      <ul className="divide-y divide-slate-100">
        {suggestions.map((s) => { const wait = minutesSince(s.candidate.checked_in_at); return (
          <li key={s.candidate.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
            <Avatar name={s.candidate.full_name} />
            <div className="min-w-0 flex-1"><div className="font-medium"><Link to="/candidates" className="hover:text-brand-700">{s.candidate.full_name}</Link> <span className="font-normal text-slate-500">→ {s.interviewer.name} is free</span></div>
              <div className="text-xs text-slate-500">{[s.candidate.queue_number && `queue #${s.candidate.queue_number}`, wait != null && `waiting ${wait < 1 ? '<1' : wait} min`, s.candidate.rounds_total > 1 && `${s.candidate.round_name} round`, s.candidate.drive_name].filter(Boolean).join(' · ')}</div></div>
            <Button size="sm" loading={assign.isPending && assign.variables?.s.candidate.id === s.candidate.id} onClick={() => assign.mutate({ s })}>Assign to {s.interviewer.name.split(' ')[0]}</Button>
          </li>) })}
      </ul>
      {error && <div className="mt-2"><Alert>{error}</Alert></div>}
      <p className="mt-2 text-xs text-slate-400">Picks the longest wait for each free interviewer who is not on a break and has room. You decide: nothing is assigned until you press the button.</p>
    </Card>
  )
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
    <Card title={<span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-brand-600" /> Get set up · {done} of {steps.length} done</span>}>
      <div className="mb-4 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={steps.length}><div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${(done / steps.length) * 100}%` }} /></div>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {steps.map(([label, ok, to]) => (
          <li key={label}><Link to={to} className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition ${ok ? 'border-emerald-200 bg-emerald-50/50 text-slate-500' : 'border-slate-200 bg-white text-slate-800 hover:border-brand-300'}`}>
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
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="flex items-center gap-1.5 text-[13px] font-medium text-slate-500"><CalendarDays className="h-3.5 w-3.5" /> {today}</p>
          <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-tight">{hourGreeting()}, {name}</h1>
          <p className="mt-1 text-sm text-slate-500">{m ? (m.total ? <>{m.waiting} waiting · {m.in_interview} in interview · {m.pending_feedback} feedback due{m.avg_wait_min != null && <> · avg wait {m.avg_wait_min} min</>}{m.avg_interview_min != null && <> · avg interview {m.avg_interview_min} min</>}</> : 'Your hiring drives will show up here as candidates register.') : 'Loading…'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="input !w-auto" value={driveId} onChange={(e) => setDriveId(e.target.value)} aria-label="Hiring drive">
            <option value="">All drives</option>{drives.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <Link to="/approvals" className="inline-flex h-8 items-center gap-1.5 rounded-[7px] bg-white px-3 text-[13px] font-medium shadow-card ring-1 ring-inset ring-slate-200 hover:bg-slate-50"><ShieldCheck className="h-3.5 w-3.5 text-slate-500" /> Approvals{m?.pending_approvals > 0 && <span className="mono rounded-full bg-brand-600 px-1.5 text-[11px] text-white">{m.pending_approvals}</span>}</Link>
          <Link to="/drives" className="inline-flex h-8 items-center gap-1.5 rounded-[7px] bg-ink-800 px-3 text-[13px] font-medium text-white shadow-btn hover:bg-ink-700"><Plus className="h-3.5 w-3.5" /> New drive</Link>
        </div>
      </header>

      {dash.isLoading ? <Spinner /> : dash.isError ? <Alert>{dash.error.message}</Alert> : (<>
        <SetupChecklist setup={d.setup} vs={vs.data} />
        <UpNext suggestions={d.suggestions} />

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Tile kind="solid" icon={Users} label="Total candidates" value={m.total} hint="In this selection" to="/candidates" spark={cumulative(d.timeline)} />
          <Tile kind="soft" icon={Inbox} label="Registered" value={m.registered} hint="Not yet checked in" />
          <Tile icon={LogIn} label="Checked in" value={m.checked_in} hint={m.total ? `${Math.round((m.checked_in / m.total) * 100)}% of registered` : 'Arrived at the venue'} />
          <Tile icon={Hourglass} label="Waiting" value={m.waiting} hint="In the queue" />
          <Tile icon={CheckCircle2} label="Interviews done" value={m.completed} hint={m.stages.selected ? `${m.stages.selected} selected` : undefined} />
          <Tile kind={m.pending_feedback ? 'warn' : 'plain'} icon={ClipboardCheck} label="Pending feedback" value={m.pending_feedback} hint={m.pending_feedback ? 'Needs attention' : 'All caught up'} to={m.pending_feedback ? '/candidates?pending_feedback=1' : undefined} />
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
                <li key={c.id} className="flex items-center gap-3 rounded-lg bg-brand-50 px-3 py-2"><Avatar name={c.full_name} />
                  <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{c.full_name}</div><div className="truncate text-xs text-slate-500">with {c.interviewer || 'no interviewer'}</div></div>
                  <span className="flex items-center gap-1 text-xs font-medium tabular-nums text-brand-700"><Timer className="h-3.5 w-3.5" />{minutesSince(c.interview_started_at) ?? 0} min</span></li>))}</ul>)}
          </Card>
          <Card title={<span className="flex items-center gap-2">Up next {m.waiting > 0 && <Badge tone="amber">{m.waiting}</Badge>}</span>} action={<Link to="/candidates" className="text-xs text-brand-600">View all</Link>}>
            {d.waiting.length === 0 ? <Empty>Nobody is waiting.</Empty> : (
              <ul className="space-y-2">{d.waiting.slice(0, 6).map((c) => {
                const wait = minutesSince(c.checked_in_at); const long = wait != null && wait >= 30
                return (
                  <li key={c.id} className="flex items-center gap-3 text-sm"><Token n={c.queue_number} />
                    <div className="min-w-0 flex-1"><div className="truncate font-medium">{c.full_name}</div><div className="truncate text-xs text-slate-500">{c.interviewer ? `with ${c.interviewer}` : 'no interviewer yet'}</div></div>
                    {wait != null && <span className={`flex items-center gap-1 whitespace-nowrap text-xs tabular-nums ${long ? 'font-medium text-rose-600' : 'text-slate-500'}`}><Clock className="h-3.5 w-3.5" />{wait < 1 ? '<1' : wait} min{long && <span className="sr-only"> (long wait)</span>}</span>}</li>)
              })}{m.waiting > 6 && <li className="pt-1 text-xs text-slate-500">+ {m.waiting - 6} more in the queue</li>}</ul>)}
          </Card>
          <Card title="Interviewer workload" action={<Link to="/interviewers" className="text-xs text-brand-600">Manage</Link>}>
            {d.interviewer_load.length === 0 ? <Empty>Add interviewers to see their workload.</Empty> : <LoadBars rows={d.interviewer_load} />}
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Pending feedback" action={<Link to="/candidates?pending_feedback=1" className="text-xs text-brand-600">View all</Link>}>
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

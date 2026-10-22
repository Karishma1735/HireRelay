import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Users, LogIn, Hourglass, CheckCircle2, ClipboardCheck, Plus, ArrowRight, Check, Clock, Timer, Inbox, Sparkles, CalendarDays, ShieldCheck } from 'lucide-react'
import { get } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { ago } from '../lib/format.js'
import { Alert, Avatar, Badge, Card, Empty, Spinner } from '../components/ui.jsx'
import { AreaChart, Funnel, LoadBars, RAMP } from '../components/charts.jsx'

const minutesSince = (d) => (d ? Math.max(0, Math.round((Date.now() - new Date(d)) / 60000)) : null)
const cumulative = (tl) => { let n = 0; return (tl || []).map((x) => (n += x.count)) }
const hourGreeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening' }

function Spark({ points, color }) {
  if (!points || points.filter((p) => p > 0).length < 3) return null
  const m = Math.max(...points); const n = points.length
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${((i * 100) / (n - 1)).toFixed(1)},${(26 - (p / m) * 22).toFixed(1)}`).join(' ')
  return <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="h-8 w-24" aria-hidden="true"><path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" /></svg>
}

function Tile({ icon: Icon, label, value, hint, tone = 'brand', to, spark }) {
  const t = { brand: ['bg-brand-50 text-brand-600', '#5B5BF0'], amber: ['bg-amber-50 text-amber-600', '#F59E0B'], green: ['bg-emerald-50 text-emerald-600', '#10B981'], red: ['bg-rose-50 text-rose-600', '#F43F5E'], teal: ['bg-teal-50 text-teal-600', '#14B8A6'] }[tone]
  const body = (
    <div className="flex h-full flex-col rounded-3xl bg-white/90 p-5 shadow-card ring-1 ring-slate-200/70 transition hover:-translate-y-0.5 hover:shadow-lg">
      <div className="flex items-center justify-between text-[13px] font-medium text-slate-500">{label}<span className={`flex h-8 w-8 items-center justify-center rounded-xl ${t[0]}`}><Icon className="h-4 w-4" /></span></div>
      <div className="mt-3 flex items-end justify-between gap-2"><span className="text-[38px] font-semibold leading-none tracking-tight tabular-nums text-slate-900">{value ?? '—'}</span><Spark points={spark} color={t[1]} /></div>
      {hint && <div className="mt-2.5 text-xs text-slate-500">{hint}</div>}
    </div>)
  return to ? <Link to={to} className="block rounded-3xl focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300">{body}</Link> : body
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

/** Plain-language read of what needs HR's attention right now. Everything here is computed from live data. */
function Attention({ d, m }) {
  const longest = [...(d.waiting || [])].filter((c) => c.checked_in_at).sort((a, b) => new Date(a.checked_in_at) - new Date(b.checked_in_at))[0]
  const wait = longest ? minutesSince(longest.checked_in_at) : null
  const items = []
  if (longest && wait >= 15) items.push({ icon: Clock, tone: 'bg-amber-50 text-amber-600', title: `${longest.full_name} has waited ${wait} minutes`, sub: `Longest wait in the queue${longest.interviewer ? `, assigned to ${longest.interviewer}` : ', no interviewer assigned yet'}`, to: '/candidates', cta: 'Open' })
  if (m.pending_feedback > 0) items.push({ icon: ClipboardCheck, tone: 'bg-rose-50 text-rose-600', title: `${m.pending_feedback} feedback ${m.pending_feedback > 1 ? 'forms are' : 'form is'} missing`, sub: 'Interviews are finished but the interviewer has not submitted feedback', to: '/candidates?pending_feedback=1', cta: 'Review' })
  if (m.pending_approvals > 0) items.push({ icon: ShieldCheck, tone: 'bg-violet-50 text-violet-600', title: `${m.pending_approvals} ${m.pending_approvals > 1 ? 'emails are' : 'email is'} waiting for your approval`, sub: 'Nothing is sent until you approve it', to: '/approvals', cta: 'Approve' })
  if (!items.length) return null
  return (
    <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#2A2A6B] via-[#3B3BA8] to-[#6D4FD8] p-6 text-white shadow-[0_20px_40px_-18px_rgba(60,60,170,.55)]">
      <div className="pointer-events-none absolute -right-10 -top-10 h-44 w-44 rounded-full bg-white/10 blur-2xl" />
      <div className="relative flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand-200"><Sparkles className="h-3.5 w-3.5" /> Needs your attention</div>
      <ul className="relative mt-3 grid gap-3 lg:grid-cols-3">
        {items.map((it) => (
          <li key={it.title}><Link to={it.to} className="flex h-full items-start gap-3 rounded-2xl bg-white/10 p-4 ring-1 ring-white/15 transition hover:bg-white/15">
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${it.tone}`}><it.icon className="h-4 w-4" /></span>
            <div className="min-w-0 flex-1"><div className="text-sm font-semibold leading-snug">{it.title}</div><div className="mt-0.5 text-xs leading-snug text-brand-100">{it.sub}</div></div>
            <span className="self-center rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-brand-700">{it.cta}</span></Link></li>))}
      </ul>
    </section>
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
          <p className="flex items-center gap-1.5 text-sm font-medium text-slate-500"><CalendarDays className="h-4 w-4" /> {today}</p>
          <h1 className="mt-1 text-[30px] font-semibold leading-tight tracking-tight sm:text-[34px]">{hourGreeting()}, {name}</h1>
          <p className="mt-1 text-[15px] text-slate-500">{m ? (m.total ? <>{m.waiting} waiting · {m.in_interview} in interview · {m.pending_feedback} feedback due</> : 'Your hiring drives will show up here as candidates register.') : 'Loading…'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="rounded-full bg-white/80 px-4 py-2.5 text-sm font-medium shadow-sm ring-1 ring-slate-200/80" value={driveId} onChange={(e) => setDriveId(e.target.value)} aria-label="Hiring drive">
            <option value="">All drives</option>{drives.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <Link to="/approvals" className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-4 py-2.5 text-sm font-semibold shadow-sm ring-1 ring-slate-200/80 hover:bg-white"><ShieldCheck className="h-4 w-4 text-slate-500" /> Approvals{m?.pending_approvals > 0 && <span className="rounded-full bg-amber-500 px-1.5 text-xs text-white">{m.pending_approvals}</span>}</Link>
          <Link to="/drives" className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-brand-600 to-[#9B6BFF] px-5 py-2.5 text-sm font-semibold text-white shadow-glow hover:brightness-110"><Plus className="h-4 w-4" /> New drive</Link>
        </div>
      </header>

      {dash.isLoading ? <Spinner /> : dash.isError ? <Alert>{dash.error.message}</Alert> : (<>
        <SetupChecklist setup={d.setup} vs={vs.data} />

        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <Tile icon={Users} label="Total candidates" value={m.total} hint={m.registered ? `${m.registered} not checked in yet` : 'In this selection'} to="/candidates" spark={cumulative(d.timeline)} />
          <Tile icon={Hourglass} label="Waiting now" value={m.waiting} tone="amber" hint={m.avg_wait_min == null ? 'Nobody in the queue' : `Avg wait ${m.avg_wait_min} min`} />
          <Tile icon={CheckCircle2} label="Interviews done" value={m.completed} tone="teal" hint={m.avg_interview_min == null ? 'None finished yet' : `Avg interview ${m.avg_interview_min} min`} />
          <Tile icon={ClipboardCheck} label="Pending feedback" value={m.pending_feedback} tone={m.pending_feedback ? 'red' : 'green'} hint={m.pending_feedback ? 'Needs attention' : 'All caught up'} to={m.pending_feedback ? '/candidates?pending_feedback=1' : undefined} />
        </div>

        <Attention d={d} m={m} />

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
                <li key={c.id} className="flex items-center gap-3 rounded-xl bg-brand-50/60 px-3 py-2"><Avatar name={c.full_name} />
                  <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{c.full_name}</div><div className="truncate text-xs text-slate-500">with {c.interviewer || 'no interviewer'}</div></div>
                  <span className="flex items-center gap-1 text-xs font-medium tabular-nums text-brand-700"><Timer className="h-3.5 w-3.5" />{minutesSince(c.interview_started_at) ?? 0} min</span></li>))}</ul>)}
          </Card>
          <Card title={<span className="flex items-center gap-2">Up next {m.waiting > 0 && <Badge tone="amber">{m.waiting}</Badge>}</span>} action={<Link to="/candidates" className="text-xs text-brand-600">View all</Link>}>
            {d.waiting.length === 0 ? <Empty>Nobody is waiting.</Empty> : (
              <ul className="space-y-2">{d.waiting.slice(0, 6).map((c) => {
                const wait = minutesSince(c.checked_in_at); const long = wait != null && wait >= 30
                return (
                  <li key={c.id} className="flex items-center gap-3 text-sm"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-50 text-xs font-semibold tabular-nums text-amber-700">#{c.queue_number}</span>
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

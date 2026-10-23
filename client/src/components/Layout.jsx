import { NavLink, Outlet, Link, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { LayoutGrid, CalendarDays, Users, UserCog, Sparkles, ShieldCheck, Plug, LogOut, Workflow } from 'lucide-react'
import { useAuth } from '../lib/auth.jsx'
import { get } from '../lib/api.js'
import { Avatar } from './ui.jsx'

const NAV = [
  ['/', 'Dashboard', LayoutGrid], ['/drives', 'Hiring drives', CalendarDays], ['/candidates', 'Candidates', Users],
  ['/interviewers', 'Interviewers', UserCog], ['/agent', 'AI agent', Sparkles], ['/approvals', 'Approvals & activity', ShieldCheck], ['/integrations', 'Integrations', Plug]
]
const SECTION = { '': 'Dashboard', drives: 'Hiring drives', candidates: 'Candidates', interviewers: 'Interviewers', agent: 'AI agent', approvals: 'Approvals & activity', integrations: 'Integrations', setup: 'Setup' }

export default function Layout() {
  const { signOut, session } = useAuth()
  const { pathname } = useLocation()
  const pending = useQuery({ queryKey: ['approvals', 'pending-count'], queryFn: () => get('/approvals?status=pending'), refetchInterval: 15000 })
  const drives = useQuery({ queryKey: ['drives'], queryFn: () => get('/drives'), refetchInterval: 30000 })
  const count = pending.data?.length || 0
  const email = session.user.email
  const [first, second] = pathname.split('/').filter(Boolean)
  const detail = second ? ({ drives: drives.data?.find((d) => d.id === second)?.name, interviewers: 'Interviewer' }[first] || 'Details') : null

  return (
    <div className="min-h-screen lg:flex">
      <aside className="bg-ink-900 text-slate-300 lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-60 lg:shrink-0 lg:flex-col">
        <div className="flex items-center justify-between px-4 py-3 lg:px-4 lg:py-4">
          <Link to="/" className="flex items-center gap-2.5 text-white"><span className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-white text-ink-900"><Workflow className="h-4 w-4" /></span><span className="text-[14.5px] font-semibold tracking-tight">HireRelay</span></Link>
          <button className="text-xs text-slate-400 lg:hidden" onClick={() => signOut()}>Sign out</button>
        </div>
        <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-2 pb-2 lg:flex-col lg:gap-0.5 lg:px-3 lg:pb-0">
          {NAV.map(([to, label, Icon]) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `flex h-8 shrink-0 items-center gap-2.5 whitespace-nowrap rounded-[7px] px-2.5 text-[13.5px] font-medium transition ${isActive ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}>
              <Icon className="h-4 w-4" /> {label}
              {to === '/approvals' && count > 0 && <span className="mono ml-auto rounded-full bg-white/15 px-1.5 text-[11px] text-white">{count}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="mt-5 hidden min-h-0 flex-1 overflow-y-auto px-3 lg:block">
          {drives.data?.length > 0 && (<>
            <div className="px-2.5 text-[11px] font-medium uppercase tracking-[.08em] text-slate-500">Drives</div>
            <div className="mt-1.5 space-y-0.5">
              {drives.data.slice(0, 8).map((d) => (
                <NavLink key={d.id} to={`/drives/${d.id}`} className={({ isActive }) => `flex h-8 items-center gap-2.5 truncate rounded-[7px] px-2.5 text-[13px] transition ${isActive ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}>
                  <i className={`h-1.5 w-1.5 shrink-0 rounded-full ${d.status === 'active' ? 'bg-brand-400' : 'bg-slate-600'}`} /><span className="truncate">{d.name}</span>
                </NavLink>))}
            </div>
          </>)}
        </div>
        <div className="hidden items-center gap-2.5 border-t border-white/10 px-4 py-3 lg:flex">
          <Avatar name={email} size="h-8 w-8 text-xs" />
          <div className="min-w-0 flex-1"><div className="truncate text-[12.5px] text-white">{email}</div></div>
          <button onClick={() => signOut()} className="rounded p-1.5 text-slate-400 hover:bg-white/10 hover:text-white" aria-label="Sign out" title="Sign out"><LogOut className="h-4 w-4" /></button>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <div className="sticky top-0 z-20 hidden h-12 items-center border-b border-slate-200 bg-[#F6F7F9]/90 px-8 text-[13.5px] backdrop-blur lg:flex">
          {detail ? (<><Link to={`/${first}`} className="text-slate-500 hover:text-ink-900">{SECTION[first]}</Link><span className="mx-2 text-slate-300">/</span><span className="font-medium">{detail}</span></>) : <span className="font-medium">{SECTION[first || ''] || 'HireRelay'}</span>}
        </div>
        <main className="p-4 sm:p-6 lg:px-8 lg:py-7"><div className="mx-auto max-w-6xl"><Outlet /></div></main>
      </div>
    </div>
  )
}

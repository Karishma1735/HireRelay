import { NavLink, Outlet } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { LayoutGrid, CalendarDays, Users, UserCog, Sparkles, ShieldCheck, Plug, LogOut, Workflow } from 'lucide-react'
import { useAuth } from '../lib/auth.jsx'
import { get } from '../lib/api.js'
import { Avatar } from './ui.jsx'

const NAV = [
  ['/', 'Dashboard', LayoutGrid], ['/drives', 'Hiring drives', CalendarDays], ['/candidates', 'Candidates', Users],
  ['/interviewers', 'Interviewers', UserCog], ['/agent', 'AI agent', Sparkles], ['/approvals', 'Approvals & activity', ShieldCheck], ['/integrations', 'Integrations', Plug]
]
const Logo = () => <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-600 to-[#9B6BFF] text-white shadow-glow"><Workflow className="h-5 w-5" /></span>

export default function Layout() {
  const { signOut, session } = useAuth()
  const pending = useQuery({ queryKey: ['approvals', 'pending-count'], queryFn: () => get('/approvals?status=pending'), refetchInterval: 15000 })
  const count = pending.data?.length || 0
  const email = session.user.email
  return (
    <div className="min-h-screen lg:flex">
      {/* Desktop: a slim icon rail with hover labels. Small screens: a scrolling tab strip with labels. */}
      <aside className="lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-[84px] lg:shrink-0 lg:flex-col lg:items-center lg:py-6">
        <div className="flex items-center justify-between px-4 py-3 lg:block lg:p-0">
          <div className="flex items-center gap-2.5 font-semibold text-slate-900 lg:block" title="HireRelay"><Logo /><span className="lg:hidden">HireRelay</span></div>
          <button className="text-xs text-slate-500 lg:hidden" onClick={() => signOut()}>Sign out</button>
        </div>
        <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-2 pb-2 lg:mt-8 lg:flex-col lg:gap-2 lg:overflow-visible lg:p-0">
          {NAV.map(([to, label, Icon]) => (
            <NavLink key={to} to={to} end={to === '/'} aria-label={label} className={({ isActive }) => `group relative flex shrink-0 items-center gap-2 whitespace-nowrap rounded-2xl px-3 py-2 text-sm font-medium transition lg:h-11 lg:w-11 lg:justify-center lg:p-0 ${isActive ? 'bg-white text-brand-600 shadow-card ring-1 ring-slate-200/80' : 'text-slate-500 hover:bg-white/70 hover:text-slate-800'}`}>
              <Icon className="h-5 w-5" /><span className="lg:hidden">{label}</span>
              {to === '/approvals' && count > 0 && <span className="ml-auto rounded-full bg-amber-500 px-1.5 text-xs text-white lg:absolute lg:-right-1 lg:-top-1 lg:ml-0 lg:px-1 lg:text-[10px]">{count}</span>}
              <span className="pointer-events-none absolute left-14 top-1/2 z-30 hidden -translate-y-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-lg transition group-hover:opacity-100 group-focus-visible:opacity-100 lg:block">{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto hidden flex-col items-center gap-3 lg:flex">
          <button onClick={() => signOut()} className="group relative flex h-10 w-10 items-center justify-center rounded-2xl text-slate-400 hover:bg-white/70 hover:text-slate-700" aria-label="Sign out"><LogOut className="h-[18px] w-[18px]" />
            <span className="pointer-events-none absolute left-12 top-1/2 hidden -translate-y-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-lg transition group-hover:opacity-100 lg:block">Sign out · {email}</span></button>
          <span title={email}><Avatar name={email} size="h-10 w-10 text-sm" /></span>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 sm:p-6 lg:py-8 lg:pl-2 lg:pr-9"><div className="mx-auto max-w-6xl"><Outlet /></div></main>
    </div>
  )
}

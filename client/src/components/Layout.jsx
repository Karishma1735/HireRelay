import { NavLink, Outlet } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { LayoutDashboard, CalendarDays, Users, UserCog, Bot, ShieldCheck, Plug, LogOut, Radio } from 'lucide-react'
import { useAuth } from '../lib/auth.jsx'
import { get } from '../lib/api.js'

const NAV = [
  ['/', 'Dashboard', LayoutDashboard], ['/drives', 'Hiring drives', CalendarDays], ['/candidates', 'Candidates', Users],
  ['/interviewers', 'Interviewers', UserCog], ['/agent', 'AI agent', Bot], ['/approvals', 'Approvals & activity', ShieldCheck], ['/integrations', 'Integrations', Plug]
]

export default function Layout() {
  const { supabase, session } = useAuth()
  const pending = useQuery({ queryKey: ['approvals', 'pending-count'], queryFn: () => get('/approvals?status=pending'), refetchInterval: 15000 })
  const count = pending.data?.length || 0
  return (
    <div className="min-h-screen lg:flex">
      <aside className="border-b border-slate-200 bg-white lg:sticky lg:top-0 lg:h-screen lg:w-60 lg:shrink-0 lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between px-4 py-3 lg:block lg:py-5">
          <div className="flex items-center gap-2 text-lg font-bold text-indigo-700"><Radio className="h-5 w-5" /> HireRelay</div>
          <button className="text-xs text-slate-500 lg:hidden" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 lg:flex-col lg:px-3 lg:pb-0">
          {NAV.map(([to, label, Icon]) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`}>
              <Icon className="h-4 w-4" /> {label}
              {to === '/approvals' && count > 0 && <span className="ml-auto rounded-full bg-amber-500 px-1.5 text-xs text-white">{count}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="absolute bottom-0 hidden w-60 border-t border-slate-100 p-3 lg:block">
          <div className="truncate text-xs text-slate-500">{session.user.email}</div>
          <button className="mt-1 flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900" onClick={() => supabase.auth.signOut()}><LogOut className="h-3.5 w-3.5" /> Sign out</button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8"><div className="mx-auto max-w-6xl"><Outlet /></div></main>
    </div>
  )
}

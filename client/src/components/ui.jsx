import { X, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { STAGE_DOT, STAGE_LABEL, STAGE_STYLE, avatarTone, initials } from '../lib/format.js'

const VARIANTS = {
  primary: 'bg-gradient-to-r from-brand-600 to-[#9B6BFF] text-white shadow-glow hover:brightness-110 disabled:opacity-50 disabled:shadow-none',
  secondary: 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50',
  danger: 'bg-white text-rose-600 ring-1 ring-rose-200 hover:bg-rose-50 disabled:opacity-50',
  ghost: 'text-slate-600 hover:bg-slate-100 disabled:opacity-50'
}
export function Button({ variant = 'primary', size = 'md', loading, className = '', children, ...p }) {
  const pad = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-sm'
  return (
    <button {...p} disabled={p.disabled || loading} className={`inline-flex items-center justify-center gap-1.5 rounded-xl font-semibold transition ${pad} ${VARIANTS[variant]} ${className}`}>
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{children}
    </button>
  )
}
export const Card = ({ title, action, children, className = '' }) => (
  <section className={`rounded-3xl bg-white/90 shadow-card ring-1 ring-slate-200/70 ${className}`}>
    {(title || action) && <header className="flex items-center justify-between gap-2 px-5 pb-1 pt-4"><h2 className="text-[15px] font-semibold text-slate-900">{title}</h2>{action}</header>}
    <div className="p-5 pt-3">{children}</div>
  </section>
)
export const StageBadge = ({ stage }) => <span className={`inline-block whitespace-nowrap inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${STAGE_STYLE[stage]}`}><i className={`h-1.5 w-1.5 rounded-full ${STAGE_DOT[stage] || 'bg-slate-400'}`} />{STAGE_LABEL[stage] || stage}</span>
export const Badge = ({ tone = 'slate', children }) => {
  const t = { slate: 'bg-slate-100 text-slate-700', green: 'bg-emerald-100 text-emerald-700', red: 'bg-rose-100 text-rose-700', amber: 'bg-amber-100 text-amber-800', indigo: 'bg-brand-100 text-brand-700' }[tone]
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${t}`}>{children}</span>
}
export const Stat = ({ label, value, hint, tone = 'text-slate-900' }) => (
  <div className="rounded-3xl bg-white/90 p-5 shadow-card ring-1 ring-slate-200/70">
    <div className="text-[13px] font-medium text-slate-500">{label}</div>
    <div className={`mt-1 text-3xl font-semibold tabular-nums ${tone}`}>{value ?? '—'}</div>
    {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
  </div>
)
export const Empty = ({ children }) => <p className="py-6 text-center text-sm text-slate-500">{children}</p>
export const Spinner = () => <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
export function Alert({ tone = 'error', children }) {
  const s = { error: 'border-rose-200 bg-rose-50 text-rose-800', warn: 'border-amber-200 bg-amber-50 text-amber-900', ok: 'border-emerald-200 bg-emerald-50 text-emerald-800' }[tone]
  const Icon = tone === 'ok' ? CheckCircle2 : AlertTriangle
  return <div className={`flex gap-2 rounded-lg border px-3 py-2 text-sm ${s}`}><Icon className="mt-0.5 h-4 w-4 shrink-0" /><div>{children}</div></div>
}
export function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-5 py-3"><h3 className="font-semibold">{title}</h3><button onClick={onClose} aria-label="Close"><X className="h-5 w-5 text-slate-500" /></button></div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}
export const Field = ({ label, children }) => <label className="block"><span className="label">{label}</span>{children}</label>
export const Avatar = ({ name, size = 'h-9 w-9 text-xs' }) => <span className={`inline-flex ${size} shrink-0 items-center justify-center rounded-full font-semibold text-white`} style={{ background: avatarTone(name) }}>{initials(name)}</span>

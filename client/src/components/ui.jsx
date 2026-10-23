import { X, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { STAGE_DOT, STAGE_LABEL, STAGE_STYLE, avatarTone, initials, tokenLabel } from '../lib/format.js'

const VARIANTS = {
  primary: 'bg-ink-800 text-white shadow-btn hover:bg-ink-700 disabled:opacity-50',
  accent: 'bg-brand-600 text-white shadow-btn hover:bg-brand-700 disabled:opacity-50',
  secondary: 'bg-white text-ink-900 shadow-card ring-1 ring-inset ring-slate-200 hover:bg-slate-50 disabled:opacity-50',
  danger: 'bg-white text-rose-600 shadow-card ring-1 ring-inset ring-rose-200 hover:bg-rose-50 disabled:opacity-50',
  ghost: 'text-slate-600 hover:bg-slate-100 disabled:opacity-50'
}
export function Button({ variant = 'primary', size = 'md', loading, className = '', children, ...p }) {
  const pad = size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-[13px]'
  return (
    <button {...p} disabled={p.disabled || loading} className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[7px] font-medium transition active:scale-[.98] ${pad} ${VARIANTS[variant]} ${className}`}>
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{children}
    </button>
  )
}
export const Card = ({ title, action, children, className = '' }) => (
  <section className={`rounded-[10px] bg-white shadow-card ring-1 ring-slate-200/90 ${className}`}>
    {(title || action) && <header className="flex items-center justify-between gap-2 px-5 pb-1 pt-4"><h2 className="text-[14.5px] font-semibold text-ink-900">{title}</h2>{action}</header>}
    <div className="p-5 pt-3">{children}</div>
  </section>
)
export const StageBadge = ({ stage }) => (
  <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-[6px] px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STAGE_STYLE[stage]}`}>
    <i className={`h-1.5 w-1.5 rounded-full ${STAGE_DOT[stage] || 'bg-slate-400'}`} />{STAGE_LABEL[stage] || stage}
  </span>
)
export const Badge = ({ tone = 'slate', children }) => {
  const t = { slate: 'bg-slate-100 text-slate-700 ring-slate-200', green: 'bg-emerald-50 text-emerald-700 ring-emerald-200', red: 'bg-rose-50 text-rose-700 ring-rose-200', amber: 'bg-amber-50 text-amber-800 ring-amber-200', indigo: 'bg-brand-50 text-brand-700 ring-brand-200' }[tone]
  return <span className={`inline-block rounded-[6px] px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${t}`}>{children}</span>
}
export const Stat = ({ label, value, hint, tone = 'text-ink-900' }) => (
  <div className="rounded-[10px] bg-white p-5 shadow-card ring-1 ring-slate-200/90">
    <div className="text-[13px] text-slate-500">{label}</div>
    <div className={`mt-2 text-3xl font-semibold tabular-nums tracking-tight ${tone}`}>{value ?? '—'}</div>
    {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
  </div>
)
/** A queue number as a small ticket: #07. */
export const Token = ({ n }) => (n == null || n === '' ? null : <span className="mono inline-block rounded-[5px] bg-slate-100 px-1.5 py-px text-xs text-ink-800 ring-1 ring-inset ring-slate-200">{tokenLabel(n)}</span>)
export const Avatar = ({ name, size = 'h-8 w-8 text-xs' }) => <span className={`inline-flex ${size} shrink-0 items-center justify-center rounded-full font-semibold text-white`} style={{ background: avatarTone(name) }}>{initials(name)}</span>
export const Empty = ({ children }) => <p className="py-8 text-center text-sm text-slate-500">{children}</p>
export const Spinner = () => <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
export function Alert({ tone = 'error', children }) {
  const s = { error: 'border-rose-200 bg-rose-50 text-rose-800', warn: 'border-amber-200 bg-amber-50 text-amber-900', ok: 'border-emerald-200 bg-emerald-50 text-emerald-800' }[tone]
  const Icon = tone === 'ok' ? CheckCircle2 : AlertTriangle
  return <div className={`flex gap-2 rounded-lg border px-3 py-2 text-sm ${s}`}><Icon className="mt-0.5 h-4 w-4 shrink-0" /><div>{children}</div></div>
}
export function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink-900/40 p-0 backdrop-blur-[1px] sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-xl bg-white shadow-pop ring-1 ring-slate-200 sm:rounded-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5"><h3 className="text-[15px] font-semibold">{title}</h3><button onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-slate-100"><X className="h-4 w-4 text-slate-500" /></button></div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}
export const Field = ({ label, children }) => <label className="block"><span className="label">{label}</span>{children}</label>

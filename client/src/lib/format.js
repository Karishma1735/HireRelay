export const STAGE_LABEL = { registered: 'Registered', checked_in: 'Checked in', waiting: 'Waiting', in_interview: 'In interview', completed: 'Completed', selected: 'Selected', rejected: 'Rejected', no_show: 'No show' }
// Neutral by default, cobalt for "happening now", graphite for the good outcome, amber/rose only where attention is needed.
export const STAGE_STYLE = {
  registered: 'bg-slate-50 text-slate-600 ring-slate-200', checked_in: 'bg-slate-100 text-slate-700 ring-slate-200', waiting: 'bg-amber-50 text-amber-800 ring-amber-200',
  in_interview: 'bg-brand-50 text-brand-700 ring-brand-200', completed: 'bg-slate-100 text-ink-800 ring-slate-300', selected: 'bg-ink-800 text-white ring-ink-800',
  rejected: 'bg-rose-50 text-rose-700 ring-rose-200', no_show: 'bg-slate-100 text-slate-500 ring-slate-200'
}
export const STAGE_DOT = { registered: 'bg-slate-400', checked_in: 'bg-slate-500', waiting: 'bg-amber-500', in_interview: 'bg-brand-600', completed: 'bg-ink-700', selected: 'bg-white', rejected: 'bg-rose-500', no_show: 'bg-slate-400' }
const AVATARS = ['#1B2030', '#2F5BFF', '#5B6785', '#3D4560', '#2447C9', '#7C879B']
export const avatarTone = (name) => { let h = 0; for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return AVATARS[h % AVATARS.length] }
export const initials = (name) => String(name || '?').split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('')
export const tokenLabel = (n) => (n == null || n === '' ? '' : `#${String(n).padStart(2, '0')}`)
export const ago = (d) => {
  if (!d) return '—'
  const s = Math.max(1, Math.round((Date.now() - new Date(d)) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return new Date(d).toLocaleDateString()
}

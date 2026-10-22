export const STAGE_LABEL = { registered: 'Registered', checked_in: 'Checked in', waiting: 'Waiting', in_interview: 'In interview', completed: 'Completed', selected: 'Selected', rejected: 'Rejected', no_show: 'No show' }
export const STAGE_STYLE = {
  registered: 'bg-slate-50 text-slate-600 ring-1 ring-inset ring-slate-200', checked_in: 'bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200', waiting: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200',
  in_interview: 'bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200', completed: 'bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-200', selected: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
  rejected: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200', no_show: 'bg-zinc-100 text-zinc-600 ring-1 ring-inset ring-zinc-200'
}
export const STAGE_DOT = { registered: 'bg-slate-400', checked_in: 'bg-sky-500', waiting: 'bg-amber-500', in_interview: 'bg-brand-600', completed: 'bg-teal-500', selected: 'bg-emerald-500', rejected: 'bg-rose-500', no_show: 'bg-zinc-400' }
export const AVATAR_TONES = ['#5B5BF0', '#14B8A6', '#F59E0B', '#EC4899', '#0EA5E9', '#8B5CF6']
export const avatarTone = (name) => { let h = 0; for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return AVATAR_TONES[h % AVATAR_TONES.length] }
export const initials = (name) => String(name || '?').split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('')
export const ago = (d) => {
  if (!d) return '—'
  const s = Math.max(1, Math.round((Date.now() - new Date(d)) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return new Date(d).toLocaleDateString()
}

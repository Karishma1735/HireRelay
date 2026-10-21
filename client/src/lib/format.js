export const STAGE_LABEL = { registered: 'Registered', checked_in: 'Checked in', waiting: 'Waiting', in_interview: 'In interview', completed: 'Completed', selected: 'Selected', rejected: 'Rejected', no_show: 'No show' }
export const STAGE_STYLE = {
  registered: 'bg-slate-100 text-slate-700', checked_in: 'bg-sky-100 text-sky-700', waiting: 'bg-amber-100 text-amber-800',
  in_interview: 'bg-indigo-100 text-indigo-700', completed: 'bg-emerald-100 text-emerald-700', selected: 'bg-green-100 text-green-800',
  rejected: 'bg-rose-100 text-rose-700', no_show: 'bg-zinc-200 text-zinc-600'
}
export const ago = (d) => {
  if (!d) return '—'
  const s = Math.max(1, Math.round((Date.now() - new Date(d)) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return new Date(d).toLocaleDateString()
}

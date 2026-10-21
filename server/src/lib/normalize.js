export const normEmail = (v) => {
  const s = String(v ?? '').trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null
}
/** Digits only, last 10: "+91 98765-43210" and "09876543210" match. */
export const normPhone = (v) => {
  const d = String(v ?? '').replace(/\D/g, '')
  return d.length >= 7 ? d.slice(-10) : null
}
export const slugify = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'drive'

import { normEmail, normPhone } from './normalize.js'

const squash = (k) => String(k).toLowerCase().replace(/[^a-z0-9]/g, '')
const text = (v) => {
  if (v == null) return ''
  if (Array.isArray(v)) return v.map(text).filter(Boolean).join(', ')
  if (typeof v === 'object') return text(v.value ?? v.answer ?? v.text ?? Object.values(v)[0])
  return String(v).trim()
}

// Google Form questions arrive keyed by their question title, so keys are matched by meaning, not exact name.
const RULES = {
  email: { include: ['email', 'mail'], exclude: [] },
  phone: { include: ['phone', 'mobile', 'whatsapp', 'contact', 'cell'], exclude: ['email'] },
  full_name: { include: ['fullname', 'candidatename', 'yourname', 'name'], exclude: ['company', 'user', 'father', 'organi', 'college', 'institute', 'referr'] },
  role_applied: { include: ['role', 'position', 'applyingfor', 'appliedfor', 'jobtitle', 'designation'], exclude: ['current', 'present'] },
  experience_years: { include: ['experience', 'yearsofexp', 'totalexp'], exclude: [] },
  current_company: { include: ['currentcompany', 'currentemployer', 'company', 'organisation', 'organization', 'employer'], exclude: [] }
}
const SYSTEM_KEYS = new Set(['responseid', 'createtime', 'lastsubmittedtime', 'viasockethelp'])

/**
 * Maps a raw form payload (Google Forms event or the built-in form) to candidate columns.
 * `fieldMap` ({ column: "exact key" }) set on the drive wins over the heuristics.
 * Returns the mapped columns, the untouched answers as `extra`, and the response id.
 */
export function mapSubmission(raw, fieldMap = {}) {
  const entries = Object.entries(raw || {}).filter(([k]) => !SYSTEM_KEYS.has(squash(k)))
  const out = {}
  for (const [col, key] of Object.entries(fieldMap || {})) if (key && raw?.[key] !== undefined) out[col] = text(raw[key])
  for (const [col, rule] of Object.entries(RULES)) {
    if (out[col]) continue
    // Prefer the most specific include term (earlier in list) over a looser one.
    for (const term of rule.include) {
      const hit = entries.find(([k, v]) => {
        const s = squash(k)
        return s.includes(term) && !rule.exclude.some((x) => s.includes(x)) && text(v)
      })
      if (hit) { out[col] = text(hit[1]); break }
    }
  }
  const years = parseFloat(String(out.experience_years ?? '').replace(/[^0-9.]/g, ''))
  const email = out.email || null
  return {
    columns: {
      full_name: out.full_name || null,
      email,
      phone: out.phone || null,
      email_norm: normEmail(email),
      phone_norm: normPhone(out.phone),
      role_applied: out.role_applied || null,
      experience_years: Number.isFinite(years) ? years : null,
      current_company: out.current_company || null
    },
    extra: Object.fromEntries(entries.map(([k, v]) => [k, text(v)])),
    externalRef: raw?.responseId ? String(raw.responseId) : null
  }
}

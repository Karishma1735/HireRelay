import { getToken } from './auth.jsx'

export class ApiError extends Error {
  constructor(message, status, code, details) { super(message); this.status = status; this.code = code; this.details = details }
}

export async function api(path, { method = 'GET', body } = {}) {
  const token = getToken()
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const json = await res.json().catch(() => ({}))
  if (res.status === 401 && token) { localStorage.removeItem('hirerelay-session'); window.location.assign('/') } // session expired
  if (!res.ok) throw new ApiError(json.error || `Request failed (${res.status})`, res.status, json.code, json.details)
  return json
}
export const get = (p) => api(p)
export const post = (p, body) => api(p, { method: 'POST', body: body ?? {} })
export const patch = (p, body) => api(p, { method: 'PATCH', body })
export const put = (p, body) => api(p, { method: 'PUT', body })
export const del = (p) => api(p, { method: 'DELETE' })

const authHeader = () => { const t = getToken(); return t ? { Authorization: `Bearer ${t}` } : {} }

/** POST a FormData (a file upload). The browser sets the multipart boundary, so no Content-Type here. */
export async function upload(path, form) {
  const res = await fetch(`/api${path}`, { method: 'POST', headers: authHeader(), body: form })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(json.error || `Upload failed (${res.status})`, res.status, json.code)
  return json
}

/** Fetch a protected file and hand it to the user: PDFs open in a new tab, other types download. */
export async function openProtectedFile(path, filename, mime) {
  const win = mime === 'application/pdf' ? window.open('', '_blank') : null // opened first so the popup is not blocked after the await
  try {
    const res = await fetch(`/api${path}`, { headers: authHeader() })
    if (!res.ok) throw new ApiError((await res.json().catch(() => ({}))).error || `Could not open the file (${res.status})`, res.status)
    const url = URL.createObjectURL(await res.blob())
    if (win) win.location.href = url
    else { const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove() }
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch (e) { win?.close(); throw e }
}

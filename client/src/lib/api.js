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

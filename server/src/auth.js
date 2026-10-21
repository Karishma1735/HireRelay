import { createClient } from '@supabase/supabase-js'
import { config } from './config.js'

/** Production token verifier: asks Supabase Auth who the bearer token belongs to. */
export function supabaseVerifier() {
  let client
  return async function verify(token) {
    if (!config.supabase.url || !(config.supabase.serviceKey || config.supabase.anonKey)) {
      throw Object.assign(new Error('Supabase is not configured'), { status: 503, code: 'supabase_not_configured' })
    }
    client ||= createClient(config.supabase.url, config.supabase.serviceKey || config.supabase.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
    const { data, error } = await client.auth.getUser(token)
    if (error || !data?.user) return null
    return { id: data.user.id, email: data.user.email }
  }
}

export function requireAuth(verify) {
  return async (req, res, next) => {
    const header = req.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    if (!token) return res.status(401).json({ error: 'Sign in required' })
    try {
      const user = await verify(token)
      if (!user) return res.status(401).json({ error: 'Invalid or expired session' })
      req.user = user
      next()
    } catch (e) { next(e) }
  }
}

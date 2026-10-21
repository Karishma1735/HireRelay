import { createClient } from '@supabase/supabase-js'

let client
/** The browser only ever gets the public URL + anon key, served by the backend from its environment. */
export async function getSupabase() {
  if (client) return client
  const cfg = await fetch('/api/config').then((r) => r.json())
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) return null
  client = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey)
  return client
}

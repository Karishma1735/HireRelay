// All configuration is read from the environment at call time so tests and the setup screen see live values.
const env = (k) => (process.env[k] || '').trim()

export const config = {
  get port() { return Number(env('PORT')) || 8787 },
  get corsOrigins() { return env('CORS_ORIGIN').split(',').map((s) => s.trim()).filter(Boolean) },
  get publicUrl() { return env('HIRERELAY_PUBLIC_URL').replace(/\/+$/, '') },
  get ingestSecret() { return env('INGEST_SECRET') },
  supabase: {
    get url() { return env('SUPABASE_URL') },
    get anonKey() { return env('SUPABASE_ANON_KEY') },
    get serviceKey() { return env('SUPABASE_SERVICE_ROLE_KEY') }
  },
  get databaseUrl() { return env('DATABASE_URL') },
  viasocket: {
    get orgId() { return env('VIASOCKET_ORG_ID') },
    get projectId() { return env('VIASOCKET_PROJECT_ID') },
    get secret() { return env('VIASOCKET_EMBED_SECRET') },
    get apiUrl() { return env('VIASOCKET_API_URL') },
    get runUrl() { return env('VIASOCKET_RUN_URL') },
    // Verified against the app documents (flow.viasocket.com/documentation/<service_id>.md).
    forms: {
      serviceId: 'rowshu8t54lr',
      triggerVersionId: 'row5hkzp1usn', // New Form Response: subscribe-event
      triggerId: 'rowjy77ttnmx',        // New Form Response: popup filteredActions, sample-event call
      pickerActionVersionId: 'row8qjgth2rt', // List Form Responses: list-options for field `id`
      authType: 'Auth2.0'
    },
    gmail: {
      serviceId: 'rowo0bqrhj5g',
      sendActionVersionId: 'rowwj0sfmhub', // Send Email: run + list-options for `from`
      sendActionId: 'rowogelpy0h6'         // Send Email: popup filteredActions
    }
  }
}

/** What is configured, as booleans only: values never leave the server. */
export function setupStatus() {
  const items = [
    { key: 'SUPABASE_URL', label: 'Supabase URL', ok: !!config.supabase.url, group: 'supabase' },
    { key: 'SUPABASE_ANON_KEY', label: 'Supabase anon key', ok: !!config.supabase.anonKey, group: 'supabase' },
    { key: 'SUPABASE_SERVICE_ROLE_KEY', label: 'Supabase service role key', ok: !!config.supabase.serviceKey, group: 'supabase' },
    { key: 'DATABASE_URL', label: 'Database URL', ok: !!config.databaseUrl, group: 'supabase' },
    { key: 'VIASOCKET_ORG_ID', label: 'viaSocket org id', ok: !!config.viasocket.orgId, group: 'viasocket' },
    { key: 'VIASOCKET_PROJECT_ID', label: 'viaSocket project id', ok: !!config.viasocket.projectId, group: 'viasocket' },
    { key: 'VIASOCKET_API_URL', label: 'viaSocket API URL', ok: !!config.viasocket.apiUrl, group: 'viasocket' },
    { key: 'VIASOCKET_RUN_URL', label: 'viaSocket run URL', ok: !!config.viasocket.runUrl, group: 'viasocket' },
    { key: 'VIASOCKET_EMBED_SECRET', label: 'viaSocket embed secret', ok: !!config.viasocket.secret, group: 'viasocket' },
    { key: 'INGEST_SECRET', label: 'Ingest signing secret', ok: !!config.ingestSecret, group: 'hirerelay' },
    { key: 'HIRERELAY_PUBLIC_URL', label: 'Public URL for viaSocket handlers', ok: isPublicUrl(config.publicUrl), group: 'hirerelay' }
  ]
  return {
    items,
    supabaseReady: items.filter((i) => i.group === 'supabase').every((i) => i.ok),
    viasocketReady: items.filter((i) => i.group === 'viasocket').every((i) => i.ok)
  }
}

export function isPublicUrl(u) {
  if (!u) return false
  try {
    const { protocol, hostname } = new URL(u)
    if (protocol !== 'https:' && protocol !== 'http:') return false
    return !/^(localhost|127\.|0\.0\.0\.0|\[?::1)/.test(hostname)
  } catch { return false }
}

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost:54321'
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

/** Service-role client (bypasses RLS). Use to seed/inspect from tests. */
export function serviceClient(): SupabaseClient {
  if (!SERVICE_ROLE) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set for tests')
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/** RLS-enforced client authenticated with a specific JWT (built via jwt-helper). */
export function rlsClient(jwt: string): SupabaseClient {
  if (!ANON_KEY) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY not set for tests')
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  })
}

/**
 * Truncates all mutable tables between tests, preserving migrations schema.
 * Global catalog (tuss_codes, tuss_catalog_versions) is left intact unless
 * the test opts in via `{ wipeCatalog: true }`.
 */
export async function resetDatabase(opts: { wipeCatalog?: boolean } = {}): Promise<void> {
  const sb = serviceClient()
  const tables = [
    'audit_log',
    'alert_status_transitions',
    'alerts',
    'webhook_event_transitions',
    'raw_webhook_events',
    'appointment_reversals',
    'appointments',
    'price_versions',
    'doctor_commission_history',
    'doctors',
    'patients',
    'procedures',
    'health_plans',
    'tenant_ghl_config',
    'user_tenants',
    'tenants',
  ]
  for (const t of tables) {
    const { error } = await sb.from(t).delete().neq('id', '00000000-0000-0000-0000-000000000000')
    if (error && !error.message.includes('no rows')) {
      // Some tables use composite PKs (user_tenants); fallback to raw SQL
      await sb.rpc('truncate_all_mutable').catch(() => {
        /* ignore - RPC optional */
      })
    }
  }
  if (opts.wipeCatalog) {
    await sb.from('tuss_codes').delete().neq('code', '__none__')
    await sb.from('tuss_catalog_versions').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  }
}

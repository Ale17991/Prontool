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
  const { error } = await sb.rpc('test_truncate_all_mutable', {
    wipe_catalog: opts.wipeCatalog ?? false,
  })
  if (error) {
    throw new Error(
      `resetDatabase failed: ${error.message}. Ensure migration 0020_test_helpers.sql is applied.`,
    )
  }

  // Also clear auth users — Supabase's auth schema isn't covered by the RPC.
  // listUsers pagina (default 50/página): sem laço, só 50 são apagados por
  // reset e os demais ACUMULAM entre arquivos na suíte completa (centenas de
  // usuários órfãos) — fonte de contaminação order-dependent. Deletamos a
  // página 1 repetidamente (que se reenche do próximo lote) até esvaziar.
  for (;;) {
    const { data } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 })
    const users = data?.users ?? []
    if (users.length === 0) break
    await Promise.all(users.map((u) => sb.auth.admin.deleteUser(u.id)))
  }
}

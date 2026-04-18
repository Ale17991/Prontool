import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './generated/types'

/**
 * Service-role client. BYPASSES RLS.
 *
 * USAGE IS STRICTLY RESTRICTED to:
 *   - /api/webhooks/ghl (ingestion of raw_webhook_events; scoped by derived tenant_id)
 *   - /api/workers/process-ghl-event (semantic processing; scoped via SET LOCAL)
 *   - scripts/seed-tuss.ts and platform-operator tooling
 *
 * The module fails loudly when imported from any other path. This is a
 * runtime guard so accidental reuse (e.g. in a tenant-facing Route Handler)
 * crashes the handler instead of silently exfiltrating data cross-tenant.
 */
const ALLOWED_CALLER_FRAGMENTS = [
  '/api/webhooks/',
  '/api/workers/',
  '/api/platform/',
  '/scripts/',
  '/supabase/seed/',
  '/src/lib/core/catalog/',
  '/tests/',
  // Dashboard SSR pages that need decrypted PII via SECURITY DEFINER RPCs
  // scoped by session.tenantId (LGPD-sensitive patient fields stored as
  // BYTEA and only decryptable via service_role).
  '/src/app/(dashboard)/pacientes/',
]

function assertCallerAllowed(): void {
  // In tests we short-circuit via NODE_ENV=test — test harness sets up its
  // own isolation. In production we verify via call stack.
  if (process.env.NODE_ENV === 'test') return

  // Normalize backslashes so the path-fragment allowlist works identically
  // on Windows (backslashes in stack traces) and POSIX.
  const stack = (new Error().stack ?? '').replace(/\\/g, '/')
  const allowed = ALLOWED_CALLER_FRAGMENTS.some((frag) => stack.includes(frag))
  if (!allowed) {
    throw new Error(
      'supabase-service.ts may not be imported outside webhooks/workers/platform paths',
    )
  }
}

let cached: SupabaseClient<Database> | null = null

export function createSupabaseServiceClient(): SupabaseClient<Database> {
  assertCallerAllowed()
  if (cached) return cached

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing')
  }

  cached = createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: 'public' },
  })
  return cached
}

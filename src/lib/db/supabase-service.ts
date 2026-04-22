import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './generated/types'

/**
 * Service-role client. BYPASSES RLS.
 *
 * Security model: every tenant-facing route handler MUST run `requireRole()`
 * (or a signature-verification equivalent for webhooks/workers) before
 * calling this function, and every subsequent query MUST filter by
 * `session.tenantId`. Tenant isolation is enforced at the handler layer
 * via requireRole + explicit tenant_id predicate, not at the DB layer.
 *
 * Original intent (circa T036) kept this restricted to webhooks/workers/
 * scripts while tenant-facing routes used the RLS-scoped server client.
 * That invariant did not survive contact with the TypeScript generics
 * mismatch between `@supabase/ssr` and `@supabase/supabase-js`, and all
 * user-story routes ended up using the service client anyway. The
 * allowlist below codifies the current architectural reality.
 *
 * What the guard still catches: accidental imports from React components,
 * hooks, middleware, or unrelated lib modules — places where the service
 * client has no business being and nothing enforces tenant scoping.
 *
 * What the guard does NOT catch: a new /api/ route forgetting to call
 * requireRole. That's requireRole's own job (every route that reads or
 * writes tenant data must invoke it); a grep-based check in CI is the
 * right place for that invariant, not this stack-trace sniffer.
 */
const ALLOWED_CALLER_FRAGMENTS = [
  // Every Route Handler under /api/ — tenant scoping via requireRole().
  '/api/',
  // Scripts and seeds run out-of-band (no request session).
  '/scripts/',
  '/supabase/seed/',
  // Domain helpers that legitimately need cross-tenant reads (catalog
  // sync dispatches alerts for any tenant affected by a retired code).
  '/src/lib/core/catalog/',
  // Test harness (NODE_ENV=test short-circuits anyway but keep for
  // belt-and-suspenders in case a test is run under a different env).
  '/tests/',
  // Dashboard SSR pages that need decrypted PII via SECURITY DEFINER RPCs
  // scoped by session.tenantId (LGPD-sensitive patient fields stored as
  // BYTEA and only decryptable via service_role).
  '/src/app/(dashboard)/operacao/pacientes/',
  // Monthly report aggregates across appointments_effective, health_plans
  // and doctors. Service client spares an extra query-planner round-trip
  // for the perf target (SC-004: < 30 s for 5 k rows) and keeps the page
  // reusing the same aggregator as the export endpoints (SC-006 parity).
  '/src/app/(dashboard)/analise/relatorios/',
  // Anamnesis template list and expense list — same pattern as pacientes:
  // getSession() + explicit tenant_id filter, sharing query shape with the
  // corresponding /api/ handlers.
  '/src/app/(dashboard)/analise/anamnese/',
  '/src/app/(dashboard)/analise/despesas/',
  // Hub de convênios (/cadastros/precos) agrega contagem de price_versions
  // por plano numa query só — mesmo padrão (tenant_id explícito). Idem
  // /cadastros/planos/[id] que lista os procedimentos precificados do plano.
  '/src/app/(dashboard)/cadastros/precos/',
  '/src/app/(dashboard)/cadastros/planos/',
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
      'supabase-service.ts may only be imported from route handlers, scripts, seeds, tests, or allowlisted SSR pages',
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

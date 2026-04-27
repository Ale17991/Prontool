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
 * SSR pages should prefer `createSupabaseServerClient()` (RLS-bound).
 * The allowlist below lists the exceptions — places where either the
 * caller legitimately needs cross-tenant reads (catalog/scripts) or
 * where the @supabase/ssr ↔ @supabase/supabase-js type mismatch still
 * hasn't been worked around for that specific page (anamnese, despesas).
 *
 * What the guard catches: accidental imports from React components,
 * hooks, middleware, or unrelated lib modules — places where the
 * service client has no business being.
 *
 * What the guard does NOT catch: a new /api/ route forgetting to call
 * requireRole. `scripts/check-require-role.mjs` (pnpm lint:auth) covers
 * that separately.
 */
// Fragments must match both dev and prod stack-trace shapes:
//   dev:  /src/app/(dashboard)/.../page.tsx
//   prod: /var/task/.next/server/app/(dashboard)/.../page.js
// So we drop the `/src` prefix and rely on the route-shaped tail.
const ALLOWED_CALLER_FRAGMENTS = [
  // Every Route Handler under /api/ — tenant scoping via requireRole().
  '/api/',
  // Scripts and seeds run out-of-band (no request session).
  '/scripts/',
  '/supabase/seed/',
  // Domain helpers that legitimately need cross-tenant reads (catalog
  // sync dispatches alerts for any tenant affected by a retired code).
  '/lib/core/catalog/',
  // Test harness (NODE_ENV=test short-circuits anyway but keep for
  // belt-and-suspenders in case a test is run under a different env).
  '/tests/',
  // Anamnesis template list and expense list — same pattern as pacientes:
  // getSession() + explicit tenant_id filter, sharing query shape with the
  // corresponding /api/ handlers.
  '/app/(dashboard)/cadastros/anamnese/',
  '/app/(dashboard)/analise/despesas/',
  // Lista de atendimentos chama list_patients_for_tenant (SECURITY DEFINER)
  // para mostrar o nome decriptado do paciente ao lado de cada atendimento.
  '/app/(dashboard)/operacao/atendimentos/',
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

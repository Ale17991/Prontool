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
  // Todo o grupo (dashboard) é território server-rendered protegido por
  // getSession() — qualquer page/layout aqui já passou pela camada de
  // auth+RBAC. Vale a pena permitir o broad fragment em vez de listar
  // cada subpath: novas páginas que precisem de service client não
  // estouram em prod só por causa de uma allowlist desatualizada.
  '/app/(dashboard)/',
  // Mesma justificativa para o grupo (auth) — fluxos pré-tenant
  // (onboarding, seletor) precisam listar tenants do usuário antes do
  // JWT ter tenant_id, e o login/registrar não importam service mesmo.
  '/app/(auth)/',
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

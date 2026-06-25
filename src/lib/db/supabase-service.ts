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
  // Tudo dentro de /app/ é território Next.js (pages, layouts, route
  // handlers, route groups). Cada rota já passa por getSession()/requireRole
  // upstream antes de tocar dados. Listar route group / subpath
  // individualmente vinha causando 5xx recorrente a cada feature nova.
  // O guard continua bloqueando o que importa: imports acidentais de
  // /lib/, /components/, /hooks/ e middleware (lugares onde service
  // client não tem o que fazer e bypassaria isolamento de tenant).
  '/app/',
  // Scripts e seeds rodam out-of-band (sem request session).
  '/scripts/',
  '/supabase/seed/',
  // Domain helpers que legitimamente precisam de leitura cross-tenant
  // (catalog sync dispara alertas para qualquer tenant afetado por um
  // código retirado).
  '/lib/core/catalog/',
  // Harness de testes (NODE_ENV=test já faz short-circuit, mas mantemos
  // como cinto-e-suspensório para testes rodando sob env diferente).
  '/tests/',
]

function assertCallerAllowed(): void {
  // Enforce SOMENTE em desenvolvimento. Em produção o Next empacota Server
  // Actions e este módulo em chunks compartilhados (.next/server/chunks/*)
  // cujo stack NÃO contém /app/ — o match por fragmento de path gera
  // falso-positivo e derruba a action com 5xx (era a causa do erro ao criar
  // clínica no /admin). A proteção real em produção é requireRole/RLS no
  // handler/action (a service-role key sequer existe no bundle do client, pois
  // não é NEXT_PUBLIC). Em dev os paths do stack são confiáveis (/src/...),
  // então mantemos o guard como sinal de import acidental.
  if (process.env.NODE_ENV !== 'development') return

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

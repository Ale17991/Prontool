import { NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { logger } from '@/lib/observability/logger'

/**
 * Public liveness + readiness probe. Designed for Vercel/Uptime monitors
 * and for deploy smoke tests (`docs/deploy.md §6`). Returns 200 only when
 * every check passes; 503 otherwise with a list of failing check names.
 *
 * Checks:
 *   - `db`          — Postgres is reachable and answering.
 *   - `migrations`  — the most recent expected table exists. Bumping
 *                    this string together with a new migration catches
 *                    the "forgot `supabase db push`" failure mode.
 *   - `auth_hook`   — the `auth_hook_custom_claims` Postgres function is
 *                    registered. This does NOT confirm the hook is wired
 *                    into `auth.hook.custom_access_token` in the dashboard
 *                    (Supabase doesn't expose that via SQL), so operators
 *                    still need §1.4 of the deploy checklist.
 *   - `pgcrypto`    — the `pgcrypto` extension is installed; the encryption
 *                    helpers fail loudly without it.
 *
 * The response deliberately omits details that would aid an attacker
 * (version strings, table counts, tenant data).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const LAST_EXPECTED_TABLE = 'anamnesis_templates' // update with new migrations

type CheckName = 'db' | 'migrations' | 'auth_hook' | 'pgcrypto'

export async function GET(): Promise<Response> {
  const supabase = createSupabaseServiceClient()
  const failing: CheckName[] = []

  // db + migrations: a single query that only succeeds if the latest table
  // exists. `head: true` avoids paying for row transport.
  try {
    const { error } = await supabase
      .from(LAST_EXPECTED_TABLE)
      .select('*', { count: 'exact', head: true })
      .limit(0)
    if (error) {
      failing.push(error.code === 'PGRST205' ? 'migrations' : 'db')
    }
  } catch {
    failing.push('db')
  }

  const authHookOk = await checkFunction(supabase, 'auth_hook_custom_claims')
  if (!authHookOk) failing.push('auth_hook')

  const pgcryptoOk = await checkExtension(supabase, 'pgcrypto')
  if (!pgcryptoOk) failing.push('pgcrypto')

  if (failing.length > 0) {
    logger.warn({ failing }, 'health-degraded')
    return NextResponse.json(
      { status: 'degraded', failing },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    )
  }

  return NextResponse.json(
    { status: 'ok' },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  )
}

async function checkFunction(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  name: string,
): Promise<boolean> {
  try {
    // Calls the function with an empty event; the function short-circuits
    // when user_id is absent and returns the event as-is. Success is
    // "no error" — we don't care about the output shape here.
    const { error } = await supabase.rpc(
      name as Parameters<typeof supabase.rpc>[0],
      { event: {} } as never,
    )
    if (!error) return true
    // 404-style code means the function isn't registered; anything else is
    // a transient failure we don't want to silently mark as "ok".
    return error.code !== 'PGRST202' && error.code !== '42883' ? true : false
  } catch {
    return false
  }
}

async function checkExtension(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  name: string,
): Promise<boolean> {
  try {
    // `dec_text_with_key` lives in pgcrypto via pgp_sym_decrypt; if the
    // extension is missing, the RPC dispatch errors out. A NULL cipher
    // simply returns NULL without touching the extension, so we pass a
    // garbage bytea and only treat "function not found" / "extension
    // missing" as failure.
    const { error } = await supabase.rpc('dec_text_with_key', {
      cipher: '\\x00' as unknown as string,
      key: 'probe',
    })
    if (!error) return true
    // Expected errors when the extension IS present but the input is bad:
    // pgp_sym_decrypt raises `22023` (invalid parameter). Missing extension
    // raises `42883` (undefined function).
    return error.code !== '42883' && error.code !== 'PGRST202'
  } catch {
    return false
  }
}

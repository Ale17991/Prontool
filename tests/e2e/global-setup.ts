/**
 * Runs once before any Playwright worker starts. Guarantees the demo tenant
 * + admin user exist before tests try to log in, and avoids the race where
 * parallel workers all call `pnpm seed:demo` at the same time and collide
 * on the `tenants_slug_key` unique constraint.
 */
import { execSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/lib/db/types'
import { loadEnv } from './fixtures'

export default async function globalSetup() {
  loadEnv()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — add them to .env.local',
    )
  }
  const sb = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: tenant } = await sb
    .from('tenants')
    .select('id')
    .eq('slug', 'clinica-demo')
    .maybeSingle()

  const admins = await sb.auth.admin.listUsers()
  const adminExists = admins.data?.users.some((u) => u.email === 'admin@clinica-demo.test')

  if (tenant && adminExists) {
    console.info('[e2e] demo seed already present — skipping')
    return
  }

  console.info('[e2e] seeding demo tenant…')
  execSync('pnpm seed:demo', { stdio: 'inherit' })
}

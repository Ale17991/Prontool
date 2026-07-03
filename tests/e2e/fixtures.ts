/**
 * Playwright E2E shared helpers.
 *
 * - Loads `.env.local` so the Supabase service client and signing helpers
 *   work the same way they do for vitest (both suites share the demo tenant).
 * - Runs the `seed:demo` script lazily the first time any spec asks for the
 *   admin credentials, so a fresh `supabase db reset` followed by
 *   `pnpm test:e2e` works with zero manual setup.
 * - Re-exports a thin login helper that drives the real /login form.
 *
 * Relative imports (not `@/` aliases) are intentional — Playwright does not
 * resolve `tsconfig.json` paths for spec files without extra plumbing.
 */
import { createHmac } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../src/lib/db/types'

let envLoaded = false
export function loadEnv() {
  if (envLoaded) return
  const envFile = ['.env.test', '.env.local'].find((f) => existsSync(join(process.cwd(), f)))
  if (envFile) {
    const lines = readFileSync(envFile, 'utf8').split(/\r?\n/)
    for (const line of lines) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
      if (match) {
        const k = match[1]
        const raw = match[2]
        if (!k || raw === undefined) continue
        const v = raw.replace(/^"|"$/g, '')
        if (!process.env[k]) process.env[k] = v
      }
    }
  }
  envLoaded = true
}

export const DEMO_ADMIN = {
  email: 'admin@clinica-demo.test',
  password: 'demo1234',
} as const

export const DEMO_TENANT_SLUG = 'clinica-demo'
export const DEMO_WEBHOOK_SECRET = 'dev-shared-secret'

/**
 * Stub retained so each spec can still call `await ensureDemoSeed()` as a
 * self-documenting prerequisite. The actual seeding happens once in
 * `global-setup.ts` before any worker boots, avoiding parallel races on the
 * unique `tenants_slug_key`.
 */
export async function ensureDemoSeed() {
  return
}

export function serviceClient(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env.local')
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function getDemoTenantId(sb: SupabaseClient<Database>): Promise<string> {
  const { data, error } = await sb
    .from('tenants')
    .select('id')
    .eq('slug', DEMO_TENANT_SLUG)
    .single()
  if (error || !data) {
    throw new Error(`demo tenant '${DEMO_TENANT_SLUG}' not found — run pnpm seed:demo`)
  }
  return data.id
}

/**
 * Drives the /login form as a real user would (fills fields, submits, waits
 * for the middleware redirect to /atendimentos). Keeps the auth cookie in the
 * browser context so subsequent `page.goto` calls are already signed in.
 *
 * The timeout is generous because the Next.js dev server lazy-compiles
 * `/operacao/atendimentos` on first hit and supabase-js adds a round trip on top.
 */
export async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto('/login', { waitUntil: 'networkidle' })
  // Wait until the client-side React bundle has hydrated before typing, or
  // React will overwrite the input values with its empty initial state on
  // first render after our page.fill() lands.
  const emailInput = page.locator('#email')
  await emailInput.waitFor({ state: 'visible' })
  await emailInput.focus()
  await emailInput.fill(DEMO_ADMIN.email)
  await page.locator('#password').fill(DEMO_ADMIN.password)
  await page.getByRole('button', { name: /entrar/i }).click()
  // Wait for either the redirect or an inline error; fail fast with the
  // error text so we don't have to guess when the page stays on /login.
  const navPromise = page
    .waitForURL((url) => url.pathname.startsWith('/operacao/atendimentos'), {
      timeout: 60_000,
    })
    .then(() => 'ok' as const)
  const errorPromise = page
    .locator('p.text-rose-700')
    .waitFor({ state: 'visible', timeout: 60_000 })
    .then(async () => {
      const msg = await page.locator('p.text-rose-700').textContent()
      return `login-error: ${msg?.trim() ?? '(empty)'}`
    })
  const outcome = await Promise.race([navPromise, errorPromise])
  if (outcome !== 'ok') throw new Error(outcome)
}

/**
 * Sign a payload the way the GHL ingress verifies it (see
 * src/lib/integrations/ghl/verify-signature.ts): hex HMAC-SHA256 of
 * `${timestamp}.${rawBody}` with the shared secret.
 */
export function signPayload(secret: string, timestamp: string, rawBody: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
}

export function buildDemoGhlPayload(overrides: { event_id: string; patient_name: string }) {
  return {
    event_id: overrides.event_id,
    event_type: 'pipeline_stage_changed',
    occurred_at: new Date().toISOString(),
    contact: {
      id: `ghl_contact_${Math.random().toString(36).slice(2, 10)}`,
      custom_fields: {
        plano: 'Unimed',
        tuss: '10101012',
        medico_id: 'CRM-12345',
        patient_name: overrides.patient_name,
        patient_cpf: '12345678900',
        patient_phone: '+5511999999999',
        patient_email: 'paciente@test.local',
        patient_birth_date: '1990-03-15',
      },
    },
    pipeline: { id: 'p1', stage_name: 'atendimento' },
  }
}

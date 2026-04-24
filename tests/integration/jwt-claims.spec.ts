/**
 * Guards the regression fixed when `getSession()` started decoding claims
 * directly from the access token: GoTrue's `/auth/v1/user` does NOT echo
 * the custom `tenant_id` / `role` claims added by the auth hook, so the
 * previous implementation (which read from `user.app_metadata`) returned
 * `null` for every real cookie-based session in production.
 *
 * This test mints a real JWT via the local Supabase auth endpoint (not
 * `mintJwt` — that uses a fake secret) and asserts `decodeJwtClaims`
 * extracts the app_metadata hook claims. If someone reverts the decoder
 * to use getUser() or the auth hook stops injecting claims, this fails.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { decodeJwtClaims } from '@/lib/auth/jwt-claims'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'

describe('decodeJwtClaims — extracts hook-added app_metadata from real JWTs', () => {
  beforeAll(async () => {
    await resetDatabase()
  })

  it('returns null for malformed inputs', () => {
    expect(decodeJwtClaims('')).toBeNull()
    expect(decodeJwtClaims('not.a.jwt.too.many')).toBeNull()
    expect(decodeJwtClaims('onlyone.part')).toBeNull()
    // invalid base64 payload
    expect(decodeJwtClaims('eyJhbGciOiJIUzI1NiJ9.~~~.sig')).toBeNull()
  })

  it('extracts tenant_id + role from a real access_token minted by Supabase', async () => {
    const { tenantId } = await seedTenant('jwt-claims')
    const { email } = await seedUser(tenantId, 'admin')

    // Need a password for this user; seedUser doesn't set one — we patch it
    // via the admin API so we can log in via the password grant and get a
    // real hook-processed token.
    const sb = serviceClient()
    const password = 'pw-' + Math.random().toString(36).slice(2, 10)
    const { data: list } = await sb.auth.admin.listUsers()
    const uid = list?.users.find((u) => u.email === email)?.id
    if (!uid) throw new Error(`test setup: could not find auth user for ${email}`)
    await sb.auth.admin.updateUserById(uid, { password })

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    const tokenRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: anonKey,
      },
      body: JSON.stringify({ email, password }),
    })
    const raw = await tokenRes.text()
    expect(tokenRes.status, raw).toBe(200)
    const body = JSON.parse(raw) as { access_token: string }
    expect(body.access_token).toBeTruthy()

    const claims = decodeJwtClaims(body.access_token)
    expect(claims, 'JWT payload should parse').not.toBeNull()
    expect(claims?.app_metadata?.tenant_id).toBe(tenantId)
    expect(claims?.app_metadata?.role).toBe('admin')
  })

  it('returns a payload without app_metadata.tenant_id when hook is not wired', () => {
    // Hand-crafted JWT with empty app_metadata — simulates the pre-0022 hook
    // state or a misconfigured production (auth hook not enabled in dashboard).
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
    const payload = Buffer.from(
      JSON.stringify({ sub: 'u', app_metadata: { provider: 'email' } }),
    ).toString('base64url')
    const token = `${header}.${payload}.sig`
    const claims = decodeJwtClaims(token)
    expect(claims?.app_metadata?.tenant_id).toBeUndefined()
    expect(claims?.app_metadata?.role).toBeUndefined()
  })
})

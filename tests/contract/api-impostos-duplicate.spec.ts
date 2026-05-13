/**
 * T019 (Feature 011) — duplicação de nome em /api/impostos retorna 409.
 *
 * Comparação case-insensitive + trim (UNIQUE INDEX
 * `taxes_active_name_unique_idx ON (tenant_id, lower(trim(name))) WHERE deleted_at IS NULL`).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

describe('Feature 011 — duplicate name conflict', () => {
  let adminJwt: string

  beforeAll(async () => {
    await resetDatabase()
    const t = await seedTenant('imp-dup')
    const admin = await seedUser(t.tenantId, 'admin')
    adminJwt = mintJwt({
      userId: admin.userId,
      email: admin.email,
      tenantId: t.tenantId,
      role: 'admin',
    })
  })

  async function postName(name: string): Promise<Response> {
    const { POST } = await import('@/app/api/impostos/route')
    return POST(
      new Request('http://localhost/api/impostos', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${adminJwt}`,
        },
        body: JSON.stringify({ name, rate_bps: 500, category: 'municipal' }),
      }),
    )
  }

  it('primeiro insert sucesso, duplicata exata → 409', async () => {
    const first = await postName('ISS')
    expect(first.status).toBe(201)
    const dup = await postName('ISS')
    expect(dup.status).toBe(409)
    const body = (await dup.json()) as { error: { code: string } }
    expect(body.error.code).toBe('TAX_DUPLICATE')
  })

  it('duplicata case-insensitive (iss vs ISS) → 409', async () => {
    const res = await postName('iss')
    expect(res.status).toBe(409)
  })

  it('duplicata com trim ("  ISS  " vs "ISS") → 409', async () => {
    const res = await postName('  ISS  ')
    expect(res.status).toBe(409)
  })

  it('outro nome → 201', async () => {
    const res = await postName('IRPJ')
    expect(res.status).toBe(201)
  })
})

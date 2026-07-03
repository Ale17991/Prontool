/**
 * T018 (Feature 011) — validação Zod / DB CHECK para /api/impostos.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

describe('Feature 011 — POST /api/impostos input validation', () => {
  let adminJwt: string

  beforeAll(async () => {
    await resetDatabase()
    const t = await seedTenant('imp-val')
    const admin = await seedUser(t.tenantId, 'admin')
    adminJwt = mintJwt({
      userId: admin.userId,
      email: admin.email,
      tenantId: t.tenantId,
      role: 'admin',
    })
  })

  async function postBody(body: unknown): Promise<Response> {
    const { POST } = await import('@/app/api/impostos/route')
    return POST(
      new Request('http://localhost/api/impostos', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${adminJwt}`,
        },
        body: JSON.stringify(body),
      }),
    )
  }

  it('rejeita rate_bps negativo', async () => {
    const res = await postBody({ name: 'X', rate_bps: -1, category: 'municipal' })
    expect(res.status).toBe(400)
  })

  it('rejeita rate_bps > 10000', async () => {
    const res = await postBody({ name: 'X', rate_bps: 10001, category: 'municipal' })
    expect(res.status).toBe(400)
  })

  it('rejeita rate_bps decimal', async () => {
    const res = await postBody({ name: 'X', rate_bps: 99.9, category: 'municipal' })
    expect(res.status).toBe(400)
  })

  it('rejeita name vazio', async () => {
    const res = await postBody({ name: '', rate_bps: 500, category: 'municipal' })
    expect(res.status).toBe(400)
  })

  it('rejeita name com 81 chars', async () => {
    const res = await postBody({
      name: 'X'.repeat(81),
      rate_bps: 500,
      category: 'municipal',
    })
    expect(res.status).toBe(400)
  })

  it('rejeita category inválida', async () => {
    const res = await postBody({ name: 'X', rate_bps: 500, category: 'inexistente' })
    expect(res.status).toBe(400)
  })

  it('aceita rate_bps=0', async () => {
    const res = await postBody({ name: 'Zero', rate_bps: 0, category: 'outro' })
    expect(res.status).toBe(201)
  })

  it('aceita rate_bps=10000 (limite máximo)', async () => {
    const res = await postBody({ name: 'Max', rate_bps: 10000, category: 'outro' })
    expect(res.status).toBe(201)
  })
})

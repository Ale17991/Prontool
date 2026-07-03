/**
 * T017 (Feature 011) — isolamento multi-tenant para /api/impostos.
 *
 * Constitution Principle III: tenant A NUNCA pode ler/atualizar imposto de
 * tenant B. Defesa em camadas: RLS (filter por jwt_tenant_id) + filtro
 * explícito por tenant_id no core.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

describe('Feature 011 — tenant isolation /api/impostos', () => {
  let tenantA: string
  let tenantB: string
  let adminAjwt: string
  let taxOfB: string

  beforeAll(async () => {
    await resetDatabase()
    tenantA = (await seedTenant('imp-iso-a')).tenantId
    tenantB = (await seedTenant('imp-iso-b')).tenantId
    const adminA = await seedUser(tenantA, 'admin')
    const adminB = await seedUser(tenantB, 'admin')
    adminAjwt = mintJwt({
      userId: adminA.userId,
      email: adminA.email,
      tenantId: tenantA,
      role: 'admin',
    })

    // Seed imposto APENAS no tenant B.
    const sb = serviceClient()
    const { data, error } = await sb
      .from('taxes' as never)
      .insert({
        tenant_id: tenantB,
        name: 'ISS-B',
        rate_bps: 500,
        category: 'municipal',
        created_by: adminB.userId,
      } as never)
      .select('id')
      .single()
    if (error) throw new Error(`seed: ${error.message}`)
    taxOfB = (data as unknown as { id: string }).id
  })

  it('GET /api/impostos (auth tenant A) NÃO retorna imposto do tenant B', async () => {
    const { GET } = await import('@/app/api/impostos/route')
    const res = await GET(
      new Request('http://localhost/api/impostos?include_inactive=true', {
        headers: { authorization: `Bearer ${adminAjwt}` },
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Array<{ id: string }>
    expect(body.find((r) => r.id === taxOfB)).toBeUndefined()
  })

  it('PATCH /api/impostos/{id-de-B} (auth tenant A) retorna 404', async () => {
    const { PATCH } = await import('@/app/api/impostos/[id]/route')
    const res = await PATCH(
      new Request(`http://localhost/api/impostos/${taxOfB}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${adminAjwt}`,
        },
        body: JSON.stringify({ rate_bps: 999 }),
      }),
      { params: { id: taxOfB } },
    )
    expect(res.status).toBe(404)

    // Confirma que o registro de B segue intacto.
    const sb = serviceClient()
    const { data } = await sb
      .from('taxes' as never)
      .select('rate_bps')
      .eq('id', taxOfB)
      .single()
    expect((data as unknown as { rate_bps: number }).rate_bps).toBe(500)
  })
})

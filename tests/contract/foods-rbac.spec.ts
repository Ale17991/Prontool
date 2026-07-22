/**
 * T014 (Feature 047 US1) — RBAC + gate de módulo da rota /api/alimentos.
 * POST cadastra alimento próprio só para admin/profissional_saude; demais 403.
 * Sem o módulo `dieta` → 404 mesmo para papel de escrita.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'
import type { TenantRole } from '@/lib/db/types'

const roles: TenantRole[] = ['admin', 'financeiro', 'recepcionista', 'profissional_saude']

const body = () =>
  JSON.stringify({
    name: 'Whey isolado — Marca X',
    group_slug: 'carnes_ovos',
    reference_grams: 30,
    protein_g: 24,
    carb_g: 1,
    fat_g: 0.5,
  })

async function postFood(jwt: string): Promise<Response> {
  const { POST } = await import('@/app/api/alimentos/route')
  return POST(
    new Request('http://localhost/api/alimentos', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
      body: body(),
    }),
  )
}

describe('Feature 047 — RBAC POST /api/alimentos', () => {
  let tenantId: string
  const users: Record<TenantRole, string> = {} as never

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('food-rbac')).tenantId
    for (const role of roles) {
      const u = await seedUser(tenantId, role)
      users[role] = mintJwt({ userId: u.userId, email: u.email, tenantId, role })
    }
  })

  for (const role of roles) {
    const expected = role === 'admin' || role === 'profissional_saude' ? 201 : 403
    it(`POST → ${expected} para ${role}`, async () => {
      const res = await postFood(users[role])
      expect(res.status).toBe(expected)
    })
  }
})

describe('Feature 047 — gate de módulo dieta', () => {
  it('sem o módulo `dieta`, POST → 404 mesmo para admin', async () => {
    await resetDatabase()
    const tenantId = (await seedTenant('food-nomod')).tenantId
    const admin = await seedUser(tenantId, 'admin')
    // Entitlement explícito SEM 'dieta' desliga o fail-open.
    const sb = serviceClient()
    const { error } = await sb.from('tenant_entitlements').insert({
      tenant_id: tenantId,
      plan: 'pro',
      status: 'active',
      modules: ['nutri_avaliacao'],
    } as never)
    if (error) throw new Error(`seed entitlements: ${error.message}`)

    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })
    const res = await postFood(jwt)
    expect(res.status).toBe(404)
  })
})

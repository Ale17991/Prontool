/**
 * T026 (Feature 047 US2) — RBAC + gate de módulo do plano alimentar.
 * Salvar/prescrever só admin/profissional_saude; sem módulo `dieta` → 404.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedPatient } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'
import type { TenantRole } from '@/lib/db/types'

const roles: TenantRole[] = ['admin', 'financeiro', 'recepcionista', 'profissional_saude']

async function postPlan(patientId: string, jwt: string): Promise<Response> {
  const { POST } = await import('@/app/api/pacientes/[id]/plano-alimentar/route')
  return POST(
    new Request(`http://localhost/api/pacientes/${patientId}/plano-alimentar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ title: 'Plano', meals: [{ name: 'Café', position: 0, items: [] }] }),
    }),
    { params: { id: patientId } },
  )
}

describe('Feature 047 — RBAC POST plano-alimentar', () => {
  let tenantId: string
  let patientId: string
  const users: Record<TenantRole, string> = {} as never

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('diet-rbac')).tenantId
    for (const role of roles) {
      const u = await seedUser(tenantId, role)
      users[role] = mintJwt({ userId: u.userId, email: u.email, tenantId, role })
    }
    patientId = await seedPatient(tenantId)
  })

  for (const role of roles) {
    const expected = role === 'admin' || role === 'profissional_saude' ? 200 : 403
    it(`POST → ${expected} para ${role}`, async () => {
      const res = await postPlan(patientId, users[role])
      expect(res.status).toBe(expected)
    })
  }
})

describe('Feature 047 — gate de módulo dieta (plano)', () => {
  it('sem o módulo `dieta`, POST → 404 mesmo para admin', async () => {
    await resetDatabase()
    const tenantId = (await seedTenant('diet-nomod')).tenantId
    const admin = await seedUser(tenantId, 'admin')
    const patientId = await seedPatient(tenantId)
    const sb = serviceClient()
    const { error } = await sb.from('tenant_entitlements').insert({
      tenant_id: tenantId,
      plan: 'pro',
      status: 'active',
      modules: ['nutri_avaliacao'],
    } as never)
    if (error) throw new Error(`seed entitlements: ${error.message}`)
    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })
    const res = await postPlan(patientId, jwt)
    expect(res.status).toBe(404)
  })
})

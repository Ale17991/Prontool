/**
 * T024 (Feature 049 US3) — RBAC + gate de módulo do recordatório.
 * Salvar só admin/profissional_saude; sem `nutri_recordatorio` → 404.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedPatient } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'
import type { TenantRole } from '@/lib/db/types'

const roles: TenantRole[] = ['admin', 'financeiro', 'recepcionista', 'profissional_saude']

async function postRecall(patientId: string, jwt: string): Promise<Response> {
  const { POST } = await import('@/app/api/pacientes/[id]/recordatorio/route')
  return POST(
    new Request(`http://localhost/api/pacientes/${patientId}/recordatorio`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
      body: JSON.stringify({
        recall_date: '2026-07-27',
        meals: [{ name: 'Café', position: 0, items: [] }],
      }),
    }),
    { params: { id: patientId } },
  )
}

describe('Feature 049 — RBAC POST recordatório', () => {
  let tenantId: string
  let patientId: string
  const users: Record<TenantRole, string> = {} as never

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('recall-rbac')).tenantId
    for (const role of roles) {
      const u = await seedUser(tenantId, role)
      users[role] = mintJwt({ userId: u.userId, email: u.email, tenantId, role })
    }
    patientId = await seedPatient(tenantId)
  })

  for (const role of roles) {
    const expected = role === 'admin' || role === 'profissional_saude' ? 200 : 403
    it(`POST → ${expected} para ${role}`, async () => {
      const res = await postRecall(patientId, users[role])
      expect(res.status).toBe(expected)
    })
  }
})

describe('Feature 049 — gate de módulo nutri_recordatorio', () => {
  it('sem o módulo, POST → 404 mesmo para admin', async () => {
    await resetDatabase()
    const tenantId = (await seedTenant('recall-nomod')).tenantId
    const admin = await seedUser(tenantId, 'admin')
    const patientId = await seedPatient(tenantId)
    const sb = serviceClient()
    const { error } = await sb.from('tenant_entitlements').insert({
      tenant_id: tenantId,
      plan: 'pro',
      status: 'active',
      modules: ['dieta'],
    } as never)
    if (error) throw new Error(`seed entitlements: ${error.message}`)
    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })
    const res = await postRecall(patientId, jwt)
    expect(res.status).toBe(404)
  })
})

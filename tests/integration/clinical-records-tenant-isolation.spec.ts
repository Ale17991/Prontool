/**
 * Cross-tenant: admin do tenant A não vê registros do tenant B.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  resetDatabase,
  serviceClient,
} from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedPatient } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

describe('clinical_records — isolamento por tenant', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('admin do tenant A só enxerga registros do próprio tenant', async () => {
    const a = await seedTenant('cr-iso-a')
    const b = await seedTenant('cr-iso-b')
    const patientA = await seedPatient(a.tenantId)
    const patientB = await seedPatient(b.tenantId)
    const adminA = await seedUser(a.tenantId, 'admin')
    const jwtA = mintJwt({ userId: adminA.userId, email: adminA.email, tenantId: a.tenantId, role: 'admin' })

    // Cria registro no tenant B via service-role (bypass)
    const sb = serviceClient()
    const userB = await seedUser(b.tenantId, 'admin')
    await sb
      .from('clinical_records')
      .insert({
        tenant_id: b.tenantId,
        patient_id: patientB,
        title: 'Não deve aparecer',
        type: 'texto',
        content: 'segredo do tenant B',
        created_by: userB.userId,
      })
      .throwOnError()

    // Lista do tenant A no paciente B → 200 vazio (paciente não pertence ao tenant)
    const { GET } = await import('@/app/api/pacientes/[id]/registros/route')
    const res = await GET(
      new Request(`http://localhost/api/pacientes/${patientB}/registros`, {
        headers: { authorization: `Bearer ${jwtA}` },
      }),
      { params: { id: patientB } },
    )
    expect(res.status).toBe(200)
    const list = (await res.json()) as unknown[]
    expect(list).toHaveLength(0)

    // Tentativa de criar registro no paciente do tenant B → 404
    // (handler procura paciente dentro do tenant do JWT)
    const { POST } = await import('@/app/api/pacientes/[id]/registros/route')
    const createRes = await POST(
      new Request(`http://localhost/api/pacientes/${patientB}/registros`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${jwtA}` },
        body: JSON.stringify({ title: 'Tentativa', content: 'Conteúdo' }),
      }),
      { params: { id: patientB } },
    )
    expect(createRes.status).toBe(404)
  })
})

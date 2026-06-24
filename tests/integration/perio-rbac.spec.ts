/**
 * Feature 041 (US1/FR-012) — RBAC de escrita do periograma, na camada da rota
 * (requireRole). recepcionista recebe 403; admin/profissional_saude criam (201).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resetDatabase } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedPatient } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'
import type { TenantRole } from '@/lib/db/types'

describe('periograma — RBAC de escrita', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  async function createAs(role: TenantRole, tenantId: string, patientId: string) {
    const user = await seedUser(tenantId, role)
    const jwt = mintJwt({ userId: user.userId, email: user.email, tenantId, role })
    const { POST } = await import('@/app/api/pacientes/[id]/periograma/route')
    return POST(
      new Request(`http://localhost/api/pacientes/${patientId}/periograma`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ dentition: 'permanent' }),
      }),
      { params: { id: patientId } },
    )
  }

  it('recepcionista recebe 403', async () => {
    const t = await seedTenant()
    const patientId = await seedPatient(t.tenantId)
    const res = await createAs('recepcionista', t.tenantId, patientId)
    expect(res.status).toBe(403)
  })

  it('admin e profissional_saude criam (201)', async () => {
    const t = await seedTenant()
    const patientId = await seedPatient(t.tenantId)
    const adminRes = await createAs('admin', t.tenantId, patientId)
    expect(adminRes.status).toBe(201)
    // novo paciente: o segundo exame seria 2º rascunho do mesmo paciente.
    const patient2 = await seedPatient(t.tenantId)
    const proRes = await createAs('profissional_saude', t.tenantId, patient2)
    expect(proRes.status).toBe(201)
  })

  it('GET lista é acessível à recepção (leitura)', async () => {
    const t = await seedTenant()
    const patientId = await seedPatient(t.tenantId)
    const user = await seedUser(t.tenantId, 'recepcionista')
    const jwt = mintJwt({ userId: user.userId, email: user.email, tenantId: t.tenantId, role: 'recepcionista' })
    const { GET } = await import('@/app/api/pacientes/[id]/periograma/route')
    const res = await GET(
      new Request(`http://localhost/api/pacientes/${patientId}/periograma`, {
        headers: { authorization: `Bearer ${jwt}` },
      }),
      { params: { id: patientId } },
    )
    expect(res.status).toBe(200)
  })
})

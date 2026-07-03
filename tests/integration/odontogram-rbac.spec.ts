/**
 * Feature 039 (US1/FR-021) — RBAC de escrita do odontograma.
 * recepcionista não cria marcação (403); admin e profissional_saude criam (201).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedPatient } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'
import type { TenantRole } from '@/lib/db/types'

async function cariesStatusId(): Promise<string> {
  const sb = serviceClient()
  const { data } = await sb.from('dental_status_catalog').select('id').eq('code', 'caries').single()
  return (data as { id: string }).id
}

describe('odontograma — RBAC de escrita', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  async function postAs(role: TenantRole, tenantId: string, patientId: string, statusId: string) {
    const user = await seedUser(tenantId, role)
    const jwt = mintJwt({ userId: user.userId, email: user.email, tenantId, role })
    const { POST } = await import('@/app/api/pacientes/[id]/odontograma/route')
    return POST(
      new Request(`http://localhost/api/pacientes/${patientId}/odontograma`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ tooth_fdi: 16, surface: 'occlusal_incisal', status_id: statusId }),
      }),
      { params: { id: patientId } },
    )
  }

  it('recepcionista recebe 403', async () => {
    const t = await seedTenant()
    const patientId = await seedPatient(t.tenantId)
    const statusId = await cariesStatusId()
    const res = await postAs('recepcionista', t.tenantId, patientId, statusId)
    expect(res.status).toBe(403)
  })

  it('admin e profissional_saude criam (201)', async () => {
    const t = await seedTenant()
    const patientId = await seedPatient(t.tenantId)
    const statusId = await cariesStatusId()
    const adminRes = await postAs('admin', t.tenantId, patientId, statusId)
    expect(adminRes.status).toBe(201)
    const proRes = await postAs('profissional_saude', t.tenantId, patientId, statusId)
    expect(proRes.status).toBe(201)
  })
})

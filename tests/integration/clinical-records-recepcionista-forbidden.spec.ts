/**
 * Recepcionista pode LER registros mas não criar nem deletar.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resetDatabase } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedPatient } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

describe('clinical_records — RBAC recepcionista', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('POST → 403, GET → 200 (lista vazia)', async () => {
    const { tenantId } = await seedTenant('cr-rbac')
    const patientId = await seedPatient(tenantId)
    const recep = await seedUser(tenantId, 'recepcionista')
    const jwt = mintJwt({
      userId: recep.userId,
      email: recep.email,
      tenantId,
      role: 'recepcionista',
    })

    const { POST, GET } = await import('@/app/api/pacientes/[id]/registros/route')

    const createRes = await POST(
      new Request(`http://localhost/api/pacientes/${patientId}/registros`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ title: 'Tentativa', content: 'Conteúdo' }),
      }),
      { params: { id: patientId } },
    )
    expect(createRes.status).toBe(403)

    const listRes = await GET(
      new Request(`http://localhost/api/pacientes/${patientId}/registros`, {
        headers: { authorization: `Bearer ${jwt}` },
      }),
      { params: { id: patientId } },
    )
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as unknown[]
    expect(list).toHaveLength(0)
  })
})

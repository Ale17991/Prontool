/**
 * Feature 039 (US1/FR-020) — isolamento por tenant no odontograma.
 * Admin do tenant A não enxerga marcações nem grava no paciente do tenant B.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedPatient } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

async function cariesStatusId(): Promise<string> {
  const sb = serviceClient()
  const { data } = await sb.from('dental_status_catalog').select('id').eq('code', 'caries').single()
  return (data as { id: string }).id
}

describe('odontograma — isolamento por tenant', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('admin do tenant A não vê nem grava no paciente do tenant B', async () => {
    const a = await seedTenant('odo-iso-a')
    const b = await seedTenant('odo-iso-b')
    const patientB = await seedPatient(b.tenantId)
    const adminA = await seedUser(a.tenantId, 'admin')
    const jwtA = mintJwt({
      userId: adminA.userId,
      email: adminA.email,
      tenantId: a.tenantId,
      role: 'admin',
    })
    const statusId = await cariesStatusId()

    // Cria marcação no tenant B (via service-role) que NÃO deve vazar para A.
    const userB = await seedUser(b.tenantId, 'profissional_saude')
    await serviceClient()
      .from('dental_chart_entries')
      .insert({
        tenant_id: b.tenantId,
        patient_id: patientB,
        tooth_fdi: 16,
        surface: 'occlusal_incisal',
        status_id: statusId,
        created_by: userB.userId,
      })
      .throwOnError()

    // GET do tenant A no paciente B → 200 com estado atual vazio.
    const { GET } = await import('@/app/api/pacientes/[id]/odontograma/route')
    const res = await GET(
      new Request(`http://localhost/api/pacientes/${patientB}/odontograma`, {
        headers: { authorization: `Bearer ${jwtA}` },
      }),
      { params: { id: patientB } },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { current: unknown[] }
    expect(body.current).toHaveLength(0)

    // POST do tenant A no paciente B → 404 (paciente fora do tenant).
    const { POST } = await import('@/app/api/pacientes/[id]/odontograma/route')
    const createRes = await POST(
      new Request(`http://localhost/api/pacientes/${patientB}/odontograma`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${jwtA}` },
        body: JSON.stringify({ tooth_fdi: 16, surface: 'occlusal_incisal', status_id: statusId }),
      }),
      { params: { id: patientB } },
    )
    expect(createRes.status).toBe(404)
  })
})

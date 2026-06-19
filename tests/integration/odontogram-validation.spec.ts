/**
 * Feature 039 (US1) — validação de marcação: dente FDI inválido e coerência
 * escopo↔surface (status de dente não aceita face; status de face exige face).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedPatient } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

async function statusIdByCode(code: string): Promise<string> {
  const sb = serviceClient()
  const { data } = await sb.from('dental_status_catalog').select('id').eq('code', code).single()
  return (data as { id: string }).id
}

describe('odontograma — validação de marcação', () => {
  let tenantId: string
  let patientId: string
  let jwt: string

  beforeEach(async () => {
    await resetDatabase()
    const t = await seedTenant()
    tenantId = t.tenantId
    patientId = await seedPatient(tenantId)
    const admin = await seedUser(tenantId, 'admin')
    jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })
  })

  async function post(body: Record<string, unknown>) {
    const { POST } = await import('@/app/api/pacientes/[id]/odontograma/route')
    return POST(
      new Request(`http://localhost/api/pacientes/${patientId}/odontograma`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
        body: JSON.stringify(body),
      }),
      { params: { id: patientId } },
    )
  }

  it('dente FDI inválido → 400', async () => {
    const statusId = await statusIdByCode('caries')
    const res = await post({ tooth_fdi: 99, surface: 'occlusal_incisal', status_id: statusId })
    expect(res.status).toBe(400)
  })

  it('status de face sem surface → 400', async () => {
    const statusId = await statusIdByCode('caries') // escopo face
    const res = await post({ tooth_fdi: 16, status_id: statusId })
    expect(res.status).toBe(400)
  })

  it('status de dente com surface → 400', async () => {
    const statusId = await statusIdByCode('missing') // escopo dente
    const res = await post({ tooth_fdi: 16, surface: 'mesial', status_id: statusId })
    expect(res.status).toBe(400)
  })

  it('marcação válida de face → 201', async () => {
    const statusId = await statusIdByCode('caries')
    const res = await post({ tooth_fdi: 16, surface: 'occlusal_incisal', status_id: statusId })
    expect(res.status).toBe(201)
  })
})

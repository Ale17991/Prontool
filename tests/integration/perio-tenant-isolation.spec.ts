/**
 * Feature 041 (US1/FR-013, SC-005) — exames periodontais não vazam entre tenants.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient, rlsClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedPatient } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

describe('periograma — isolamento multi-tenant', () => {
  let tenantA: string
  let tenantB: string
  let examId: string
  let jwtB: string

  beforeAll(async () => {
    await resetDatabase()
    const a = await seedTenant()
    tenantA = a.tenantId
    const b = await seedTenant()
    tenantB = b.tenantId
    const adminA = await seedUser(tenantA, 'admin')
    const adminB = await seedUser(tenantB, 'admin')
    jwtB = mintJwt({ userId: adminB.userId, email: adminB.email, tenantId: tenantB, role: 'admin' })
    const patientA = await seedPatient(tenantA)

    const sb = serviceClient()
    const { data } = await sb
      .from('perio_exams')
      .insert({ tenant_id: tenantA, patient_id: patientA, created_by: adminA.userId })
      .select('id')
      .single()
    examId = data!.id
  })

  it('tenant B não enxerga o exame do tenant A', async () => {
    const sb = rlsClient(jwtB)
    const { data } = await sb.from('perio_exams').select('id').eq('id', examId)
    expect(data ?? []).toHaveLength(0)
  })

  it('tenant B não consegue ler medições do exame do tenant A', async () => {
    const sb = rlsClient(jwtB)
    const { data } = await sb.from('perio_site_measurements').select('id').eq('exam_id', examId)
    expect(data ?? []).toHaveLength(0)
  })
})

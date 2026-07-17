/**
 * T015 (Feature 046) — isolamento de tenant em `nutrition_assessments`.
 * Tenant B não lê avaliação do tenant A nem insere no escopo de A.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, rlsClient, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedPatient } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

describe('Feature 046 — tenant isolation (nutrition_assessments)', () => {
  let tenantA: string
  let tenantB: string
  let bJwt: string
  let assessmentA: string
  let patientA: string

  beforeAll(async () => {
    await resetDatabase()
    tenantA = (await seedTenant('na-iso-a')).tenantId
    tenantB = (await seedTenant('na-iso-b')).tenantId
    const adminA = await seedUser(tenantA, 'admin')
    const adminB = await seedUser(tenantB, 'admin')
    bJwt = mintJwt({ userId: adminB.userId, email: adminB.email, tenantId: tenantB, role: 'admin' })
    patientA = await seedPatient(tenantA)

    const sb = serviceClient()
    const { data, error } = await sb
      .from('nutrition_assessments' as never)
      .insert({
        tenant_id: tenantA,
        patient_id: patientA,
        assessed_at: '2026-07-17',
        sex: 'F',
        age_years: 40,
        weight_kg: 65,
        created_by_user_id: adminA.userId,
      } as never)
      .select('id')
      .single()
    if (error) throw new Error(`seed: ${error.message}`)
    assessmentA = (data as unknown as { id: string }).id
  })

  it('tenant B NÃO enxerga a avaliação do tenant A', async () => {
    const rls = rlsClient(bJwt)
    const { data } = await rls.from('nutrition_assessments' as never).select('id')
    expect((data ?? []).map((r) => (r as { id: string }).id)).not.toContain(assessmentA)
  })

  it('tenant B NÃO insere no escopo do tenant A (RLS WITH CHECK)', async () => {
    const rls = rlsClient(bJwt)
    const { error } = await rls.from('nutrition_assessments' as never).insert({
      tenant_id: tenantA,
      patient_id: patientA,
      assessed_at: '2026-07-17',
      sex: 'M',
      age_years: 30,
      weight_kg: 80,
      created_by_user_id: '00000000-0000-0000-0000-000000000000',
    } as never)
    expect(error).toBeTruthy()
  })
})

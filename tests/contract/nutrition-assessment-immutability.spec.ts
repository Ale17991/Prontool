/**
 * T014 (Feature 046) — `nutrition_assessments` é append-only (imutável).
 * UPDATE/DELETE via authenticated são rejeitados; correção = nova avaliação.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, rlsClient, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedPatient } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

describe('Feature 046 — nutrition_assessments append-only', () => {
  let tenantId: string
  let adminJwt: string
  let rowId: string

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('na-imm')).tenantId
    const admin = await seedUser(tenantId, 'admin')
    adminJwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })
    const patientId = await seedPatient(tenantId)

    const sb = serviceClient()
    const { data, error } = await sb
      .from('nutrition_assessments' as never)
      .insert({
        tenant_id: tenantId,
        patient_id: patientId,
        assessed_at: '2026-07-17',
        sex: 'M',
        age_years: 30,
        weight_kg: 80,
        created_by_user_id: admin.userId,
      } as never)
      .select('id')
      .single()
    if (error) throw new Error(`seed assessment: ${error.message}`)
    rowId = (data as unknown as { id: string }).id
  })

  it('UPDATE via authenticated é REJEITADO', async () => {
    const rls = rlsClient(adminJwt)
    const { error } = await rls
      .from('nutrition_assessments' as never)
      .update({ weight_kg: 99 } as never)
      .eq('id', rowId)
    if (error) expect(error.message).toMatch(/permission|denied|append-only|forbidden/i)
    const sb = serviceClient()
    const { data } = await sb
      .from('nutrition_assessments' as never)
      .select('weight_kg')
      .eq('id', rowId)
      .single()
    expect(Number((data as unknown as { weight_kg: number }).weight_kg)).toBe(80)
  })

  it('DELETE via authenticated é REJEITADO', async () => {
    const rls = rlsClient(adminJwt)
    const { error } = await rls
      .from('nutrition_assessments' as never)
      .delete()
      .eq('id', rowId)
    if (error) expect(error.message).toMatch(/permission|denied|append-only|forbidden|DELETE/i)
    const sb = serviceClient()
    const { data } = await sb
      .from('nutrition_assessments' as never)
      .select('id')
      .eq('id', rowId)
      .maybeSingle()
    expect(data).not.toBeNull()
  })
})

/**
 * T010 (Feature 026) — Isolamento multi-tenant das 3 tabelas Memed.
 *
 * Um admin do tenant B NÃO enxerga linhas do tenant A em
 * tenant_memed_config / memed_prescribers / prescription_records (RLS por
 * jwt_tenant_id). Constituição III.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { resetDatabase, serviceClient, rlsClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedDoctor, seedPatient } from '@/tests/helpers/seed-factories'
import { seedMemedConnection, seedMemedPrescriber } from '@/tests/helpers/memed-mock'
import { mintJwt } from '@/tests/helpers/jwt-helper'

describe('Feature 026 — isolamento multi-tenant das tabelas Memed', () => {
  let tenantA: string
  let tenantB: string
  let jwtB: string

  beforeAll(async () => {
    await resetDatabase()
    const a = await seedTenant('memed-iso-a')
    const b = await seedTenant('memed-iso-b')
    tenantA = a.tenantId
    tenantB = b.tenantId

    const adminA = await seedUser(tenantA, 'admin')
    const adminB = await seedUser(tenantB, 'admin')
    jwtB = mintJwt({ userId: adminB.userId, email: adminB.email, tenantId: tenantB, role: 'admin' })

    // Dados pertencentes APENAS ao tenant A.
    await seedMemedConnection(tenantA, { createdBy: adminA.userId })
    const { doctorId } = await seedDoctor(tenantA)
    await seedMemedPrescriber(tenantA, doctorId, { createdBy: adminA.userId })
    const patientId = await seedPatient(tenantA)
    await serviceClient()
      .from('prescription_records')
      .insert({
        tenant_id: tenantA,
        patient_id: patientId,
        doctor_id: doctorId,
        memed_prescription_id: `rx-${randomUUID().slice(0, 8)}`,
        created_by_user_id: adminA.userId,
      } as never)
      .throwOnError()
  })

  it('admin do tenant B não vê tenant_memed_config do tenant A', async () => {
    const { data } = await rlsClient(jwtB).from('tenant_memed_config').select('tenant_id')
    expect(data ?? []).toHaveLength(0)
  })

  it('admin do tenant B não vê memed_prescribers do tenant A', async () => {
    const { data } = await rlsClient(jwtB).from('memed_prescribers').select('id')
    expect(data ?? []).toHaveLength(0)
  })

  it('admin do tenant B não vê prescription_records do tenant A', async () => {
    const { data } = await rlsClient(jwtB).from('prescription_records').select('id')
    expect(data ?? []).toHaveLength(0)
  })
})

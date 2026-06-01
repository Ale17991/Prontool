/**
 * T011 (Feature 026) — prescription_records é append-only.
 *
 * Triggers de imutabilidade (migration 0108): DELETE proibido; UPDATE só na
 * transição issued→deleted (setando deleted_at); qualquer outra mudança de
 * coluna é rejeitada. Constituição I.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedDoctor, seedPatient } from '@/tests/helpers/seed-factories'

async function seedPrescription(): Promise<{ id: string }> {
  const t = await seedTenant('rx-append')
  const admin = await seedUser(t.tenantId, 'admin')
  const { doctorId } = await seedDoctor(t.tenantId)
  const patientId = await seedPatient(t.tenantId)
  const id = randomUUID()
  await serviceClient()
    .from('prescription_records')
    .insert({
      id,
      tenant_id: t.tenantId,
      patient_id: patientId,
      doctor_id: doctorId,
      memed_prescription_id: `rx-${randomUUID().slice(0, 8)}`,
      created_by_user_id: admin.userId,
    } as never)
    .throwOnError()
  return { id }
}

describe('Feature 026 — prescription_records append-only', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('DELETE é bloqueado pelo trigger', async () => {
    const { id } = await seedPrescription()
    const { error } = await serviceClient().from('prescription_records').delete().eq('id', id)
    expect(error).not.toBeNull()
  })

  it('UPDATE arbitrário (memed_prescription_id) é bloqueado', async () => {
    const { id } = await seedPrescription()
    const { error } = await serviceClient()
      .from('prescription_records')
      .update({ memed_prescription_id: 'tampered' } as never)
      .eq('id', id)
    expect(error).not.toBeNull()
  })

  it('transição issued→deleted (com deleted_at) é permitida', async () => {
    const { id } = await seedPrescription()
    const { error } = await serviceClient()
      .from('prescription_records')
      .update({ status: 'deleted', deleted_at: new Date().toISOString() } as never)
      .eq('id', id)
    expect(error).toBeNull()
  })
})

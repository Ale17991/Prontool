/**
 * T011 (Feature 045) — `appointment_materials` append-only com column-guard.
 *
 * Migration 0172 relaxa a imutabilidade: o custo é um snapshot congelado no
 * INSERT, mas pode ser COMPLETADO/CORRIGIDO. O trigger
 * `enforce_appointment_materials_mutation` garante:
 *   - DELETE é proibido para papéis não-superuser.
 *   - UPDATE só pode tocar `{unit_cost_cents, material_id}`; qualquer outra
 *     coluna (quantity, tuss_code, appointment_id, …) é rejeitada — mesmo sob
 *     service-role (defesa em profundidade).
 *
 * Constituição Princípio I: imutabilidade financeira vive no snapshot de uso.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, rlsClient, serviceClient } from '@/tests/helpers/supabase-test-client'
import {
  seedTenant,
  seedUser,
  seedDoctor,
  seedAppointment,
  seedHealthPlan,
  seedProcedure,
  seedTussCode,
  seedPriceVersion,
  seedPatient,
} from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

describe('Feature 045 — appointment_materials append-only (column-guard)', () => {
  let tenantId: string
  let adminJwt: string
  let materialRowId: string

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('am-imm')).tenantId
    const admin = await seedUser(tenantId, 'admin')
    adminJwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })

    const { doctorId, commissionId } = await seedDoctor(tenantId)
    const planId = await seedHealthPlan(tenantId)
    await seedTussCode('00010045')
    const procedureId = await seedProcedure(tenantId, '00010045')
    const priceVersionId = await seedPriceVersion({
      tenantId,
      planId,
      procedureId,
      amountCents: 20000,
      validFrom: '2020-01-01',
    })
    const patientId = await seedPatient(tenantId)
    const appointmentId = await seedAppointment({
      tenantId,
      doctorId,
      planId,
      procedureId,
      priceVersionId,
      patientId,
      commissionId,
      amountCents: 20000,
      commissionBps: 3000,
    })

    const sb = serviceClient()
    const { data, error } = await sb.rpc(
      'attach_materials_to_appointment' as never,
      {
        p_appointment_id: appointmentId,
        p_materials: [{ material_name: 'Gaze estéril', quantity: 2, unit_cost_cents: 500 }],
        p_actor: admin.userId,
      } as never,
    )
    if (error) throw new Error(`attach: ${error.message}`)
    materialRowId = (data as unknown as { materials: Array<{ id: string }> }).materials[0]!.id
  })

  it('DELETE via authenticated é REJEITADO — linha permanece', async () => {
    const rls = rlsClient(adminJwt)
    const { error } = await rls
      .from('appointment_materials' as never)
      .delete()
      .eq('id', materialRowId)
    if (error) {
      expect(error.message).toMatch(/permission|denied|policy|append-only|DELETE/i)
    }
    const sb = serviceClient()
    const { data } = await sb
      .from('appointment_materials' as never)
      .select('id')
      .eq('id', materialRowId)
      .maybeSingle()
    expect(data).not.toBeNull()
  })

  it('UPDATE de coluna fora do guard (quantity) é REJEITADO mesmo sob service-role', async () => {
    const sb = serviceClient()
    const { error } = await sb
      .from('appointment_materials' as never)
      .update({ quantity: 99 } as never)
      .eq('id', materialRowId)
    expect(error).toBeTruthy()
    expect(error?.message).toMatch(/append-only|unit_cost_cents|material_id/i)
    const { data } = await sb
      .from('appointment_materials' as never)
      .select('quantity')
      .eq('id', materialRowId)
      .single()
    expect((data as unknown as { quantity: number }).quantity).toBe(2)
  })

  it('UPDATE apenas de unit_cost_cents é PERMITIDO (column-guard)', async () => {
    const sb = serviceClient()
    const { error } = await sb
      .from('appointment_materials' as never)
      .update({ unit_cost_cents: 750 } as never)
      .eq('id', materialRowId)
    expect(error).toBeNull()
    const { data } = await sb
      .from('appointment_materials' as never)
      .select('unit_cost_cents')
      .eq('id', materialRowId)
      .single()
    expect((data as unknown as { unit_cost_cents: number }).unit_cost_cents).toBe(750)
  })
})

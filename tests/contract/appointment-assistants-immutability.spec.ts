/**
 * T009 (Feature 013) — `appointment_assistants` append-only com mutação
 * restrita a `removed_at`/`removed_by`.
 *
 * Constitution Principle I: triggers garantem que UPDATE só pode setar
 * `removed_at IS NULL → NOT NULL` (e `removed_by` junto). Demais UPDATEs
 * e DELETEs são rejeitados. service_role passa (RPCs usam SECURITY DEFINER).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, rlsClient, serviceClient } from '@/tests/helpers/supabase-test-client'
import {
  seedTenant,
  seedUser,
  seedDoctor,
  seedAppointment,
  seedHealthPlan,
  seedTussCode,
  seedProcedure,
  seedPriceVersion,
  seedPatient,
} from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

describe('Feature 013 — appointment_assistants append-only', () => {
  let tenantId: string
  let liberalId: string
  let appointmentId: string
  let assistantRowId: string
  let adminJwt: string

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('aa-imm')).tenantId
    const admin = await seedUser(tenantId, 'admin')
    adminJwt = mintJwt({
      userId: admin.userId,
      email: admin.email,
      tenantId,
      role: 'admin',
    })
    const { doctorId } = await seedDoctor(tenantId) // comissionado (principal)
    const liberal = await seedDoctor(tenantId, { paymentMode: 'liberal' })
    liberalId = liberal.doctorId
    const planId = await seedHealthPlan(tenantId)
    await seedTussCode('00010012')
    const procedureId = await seedProcedure(tenantId, '00010012')
    const priceVersionId = await seedPriceVersion({
      tenantId,
      planId,
      procedureId,
      amountCents: 20000,
      validFrom: '2020-01-01',
    })
    const patientId = await seedPatient(tenantId)
    const commission = await seedDoctor(tenantId)
    // seedDoctor cria commission history para o doctor principal — use o commissionId dele.
    // Reusa o `doctorId` original; o commission acima foi para garantir um doctorId comissionado.
    void commission
    // Recupera o commissionId do doctor principal via service client.
    const sb0 = serviceClient()
    const { data: comm } = await sb0
      .from('doctor_commission_history')
      .select('id')
      .eq('doctor_id', doctorId)
      .single()
    const commissionId = (comm as unknown as { id: string }).id
    appointmentId = await seedAppointment({
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
    const { data, error } = await sb.rpc('attach_assistant_to_appointment', {
      p_appointment_id: appointmentId,
      p_assistant_doctor_id: liberalId,
      p_amount_cents: 35000,
      p_actor: admin.userId,
    } as never)
    if (error) throw new Error(`attach: ${error.message}`)
    assistantRowId = data as unknown as string
  })

  it('UPDATE direto via authenticated é REJEITADO (REVOKE + trigger)', async () => {
    const rls = rlsClient(adminJwt)
    const { error } = await rls
      .from('appointment_assistants' as never)
      .update({ frozen_amount_cents: 99999 } as never)
      .eq('id', assistantRowId)
    // RLS/REVOKE bloqueia: pode ser via erro explícito OU 0 rows afetadas.
    if (error) {
      expect(error.message).toMatch(/permission|denied|policy|append-only|core/i)
    }
    const sb = serviceClient()
    const { data } = await sb
      .from('appointment_assistants' as never)
      .select('frozen_amount_cents')
      .eq('id', assistantRowId)
      .single()
    expect((data as unknown as { frozen_amount_cents: number }).frozen_amount_cents).toBe(35000)
  })

  it('DELETE direto via authenticated é REJEITADO', async () => {
    const rls = rlsClient(adminJwt)
    const { error } = await rls
      .from('appointment_assistants' as never)
      .delete()
      .eq('id', assistantRowId)
    if (error) {
      expect(error.message).toMatch(/permission|denied|policy|append-only|DELETE/i)
    }
    const sb = serviceClient()
    const { data } = await sb
      .from('appointment_assistants' as never)
      .select('id')
      .eq('id', assistantRowId)
      .maybeSingle()
    expect(data).not.toBeNull()
  })

  it('UPDATE setando apenas removed_at + removed_by passa', async () => {
    const sb = serviceClient()
    const { error } = await sb.rpc('remove_appointment_assistant', {
      p_id: assistantRowId,
      p_actor: '00000000-0000-0000-0000-000000000000',
    } as never)
    expect(error).toBeNull()
    const { data } = await sb
      .from('appointment_assistants' as never)
      .select('removed_at, removed_by')
      .eq('id', assistantRowId)
      .single()
    expect((data as unknown as { removed_at: string | null }).removed_at).not.toBeNull()
  })

  it('Segundo UPDATE de removed_at é rejeitado (idempotência)', async () => {
    const sb = serviceClient()
    const { error } = await sb.rpc('remove_appointment_assistant', {
      p_id: assistantRowId,
      p_actor: '00000000-0000-0000-0000-000000000000',
    } as never)
    expect(error?.message).toMatch(/ASSISTANT_ALREADY_REMOVED/)
  })
})

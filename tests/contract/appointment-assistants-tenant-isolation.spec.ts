/**
 * T010 (Feature 013) — isolamento multi-tenant em `appointment_assistants`
 * via RLS + trigger `check_assistant_tenant_consistency`.
 *
 * Constitution Principle III: tenant A nunca lê assistant de tenant B,
 * e tentativa de cross-link entre appointment de A e doctor de B falha
 * com `ASSISTANT_TENANT_MISMATCH`.
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

async function seedAppointmentWithLiberal(tenantId: string) {
  const admin = await seedUser(tenantId, 'admin')
  const { doctorId } = await seedDoctor(tenantId)
  const { doctorId: liberalId } = await seedDoctor(tenantId, { paymentMode: 'liberal' })
  const planId = await seedHealthPlan(tenantId)
  await seedTussCode(`0001${tenantId.slice(0, 4)}`)
  const procedureId = await seedProcedure(tenantId, `0001${tenantId.slice(0, 4)}`)
  const priceVersionId = await seedPriceVersion({
    tenantId,
    planId,
    procedureId,
    amountCents: 20000,
    validFrom: '2020-01-01',
  })
  const patientId = await seedPatient(tenantId)
  const sb = serviceClient()
  const { data: comm } = await sb
    .from('doctor_commission_history')
    .select('id')
    .eq('doctor_id', doctorId)
    .single()
  const commissionId = (comm as unknown as { id: string }).id
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
  // Adiciona um assistente liberal para gerar uma row.
  const { data: assistantId, error } = await sb.rpc('attach_assistant_to_appointment', {
    p_appointment_id: appointmentId,
    p_assistant_doctor_id: liberalId,
    p_amount_cents: 35000,
    p_actor: admin.userId,
  } as never)
  if (error) throw new Error(`attach: ${error.message}`)
  return {
    appointmentId,
    assistantRowId: assistantId as unknown as string,
    liberalId,
    adminUserId: admin.userId,
  }
}

describe('Feature 013 — appointment_assistants tenant isolation', () => {
  let tenantA: string
  let tenantB: string
  let adminAjwt: string
  let assistantOfB: string
  let appointmentOfA: string
  let liberalOfB: string

  beforeAll(async () => {
    await resetDatabase()
    tenantA = (await seedTenant('aa-iso-a')).tenantId
    tenantB = (await seedTenant('aa-iso-b')).tenantId
    const adminA = await seedUser(tenantA, 'admin')
    adminAjwt = mintJwt({
      userId: adminA.userId,
      email: adminA.email,
      tenantId: tenantA,
      role: 'admin',
    })
    const a = await seedAppointmentWithLiberal(tenantA)
    appointmentOfA = a.appointmentId
    const b = await seedAppointmentWithLiberal(tenantB)
    assistantOfB = b.assistantRowId
    liberalOfB = b.liberalId
  })

  it('admin do tenant A NÃO lê appointment_assistants do tenant B', async () => {
    const rls = rlsClient(adminAjwt)
    const { data, error } = await rls
      .from('appointment_assistants' as never)
      .select('id')
      .eq('id', assistantOfB)
    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(0)
  })

  it('Tentativa de anexar liberal do tenant B em appointment do tenant A falha com ASSISTANT_TENANT_MISMATCH', async () => {
    const sb = serviceClient()
    const { error } = await sb.rpc('attach_assistant_to_appointment', {
      p_appointment_id: appointmentOfA,
      p_assistant_doctor_id: liberalOfB,
      p_amount_cents: 10000,
      p_actor: '00000000-0000-0000-0000-000000000000',
    } as never)
    expect(error?.message).toMatch(/TENANT_MISMATCH/i)
  })
})

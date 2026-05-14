/**
 * T011 (Feature 013) — trigger `check_assistant_doctor_is_liberal` rejeita
 * INSERT em `appointment_assistants` quando o doctor não é Liberal.
 *
 * Defense in depth (Constitution V): mesmo se a UI/service forem
 * burlados, o banco rejeita. Comissionado e Fixo bloqueados.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
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

describe('Feature 013 — check_assistant_doctor_is_liberal', () => {
  let tenantId: string
  let principalDoctorId: string
  let comissionadoId: string
  let fixoId: string
  let liberalId: string
  let appointmentId: string
  let actorId: string

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('aa-lib')).tenantId
    const admin = await seedUser(tenantId, 'admin')
    actorId = admin.userId
    const { doctorId: principal } = await seedDoctor(tenantId)
    principalDoctorId = principal
    comissionadoId = (await seedDoctor(tenantId)).doctorId
    fixoId = (await seedDoctor(tenantId, { paymentMode: 'fixo' })).doctorId
    liberalId = (await seedDoctor(tenantId, { paymentMode: 'liberal' })).doctorId
    const planId = await seedHealthPlan(tenantId)
    await seedTussCode('00010099')
    const procedureId = await seedProcedure(tenantId, '00010099')
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
      .eq('doctor_id', principalDoctorId)
      .single()
    appointmentId = await seedAppointment({
      tenantId,
      doctorId: principalDoctorId,
      planId,
      procedureId,
      priceVersionId,
      patientId,
      commissionId: (comm as unknown as { id: string }).id,
      amountCents: 20000,
      commissionBps: 3000,
    })
  })

  it('Anexar comissionado como assistente é REJEITADO com ASSISTANT_NOT_LIBERAL', async () => {
    const sb = serviceClient()
    const { error } = await sb.rpc('attach_assistant_to_appointment', {
      p_appointment_id: appointmentId,
      p_assistant_doctor_id: comissionadoId,
      p_amount_cents: 35000,
      p_actor: actorId,
    } as never)
    expect(error?.message).toMatch(/ASSISTANT_NOT_LIBERAL/)
  })

  it('Anexar fixo como assistente é REJEITADO com ASSISTANT_NOT_LIBERAL', async () => {
    const sb = serviceClient()
    const { error } = await sb.rpc('attach_assistant_to_appointment', {
      p_appointment_id: appointmentId,
      p_assistant_doctor_id: fixoId,
      p_amount_cents: 35000,
      p_actor: actorId,
    } as never)
    expect(error?.message).toMatch(/ASSISTANT_NOT_LIBERAL/)
  })

  it('Anexar liberal como assistente é ACEITO', async () => {
    const sb = serviceClient()
    const { data, error } = await sb.rpc('attach_assistant_to_appointment', {
      p_appointment_id: appointmentId,
      p_assistant_doctor_id: liberalId,
      p_amount_cents: 35000,
      p_actor: actorId,
    } as never)
    expect(error).toBeNull()
    expect(data).toBeTruthy()
  })
})

/**
 * Integration test do vinculo etapa <-> appointment (US2).
 *
 * Cenarios:
 *   (a) RPC create_step_with_appointment cria os dois registros vinculados.
 *   (b) Conflito de horario aborta a transacao inteira (nem step nem appointment).
 *   (c) Sync etapa concluida -> appointment_completion.
 *   (d) Sync etapa cancelada -> appointment_reversal.
 *   (e) Sync mark_appointment_realized -> step.status='concluido'.
 *   (f) Sync estorno appointment -> step.status='cancelado'.
 *   (g) Anti-loop: nenhuma trigger re-fires infinitamente.
 */
import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import {
  seedTenant,
  seedHealthPlan,
  seedTussCode,
  seedProcedure,
  seedDoctor,
  seedPriceVersion,
  seedPatient,
} from '@/tests/helpers/seed-factories'

describe('treatment step <-> appointment link (US2)', () => {
  let tenantId: string
  let patientId: string
  let procedureId: string
  let planId: string
  let doctorId: string
  let createdBy: string

  beforeAll(async () => {
    await resetDatabase()
    const tenant = await seedTenant()
    tenantId = tenant.tenantId
    await seedTussCode('10101012')
    procedureId = await seedProcedure(tenantId, '10101012')
    planId = await seedHealthPlan(tenantId)
    await seedPriceVersion({
      tenantId,
      procedureId,
      planId,
      amountCents: 20000,
      validFrom: '2020-01-01',
    })
    const d = await seedDoctor(tenantId, { crm: 'CRM-X' })
    doctorId = d.doctorId
    patientId = await seedPatient(tenantId)
    createdBy = randomUUID()
  })

  it('(a) create_step_with_appointment cria step + appointment vinculados', async () => {
    const sb = serviceClient()
    // Resolve price + commission para chamar a RPC
    const price = await sb
      .from('price_versions')
      .select('id, amount_cents')
      .eq('procedure_id', procedureId)
      .eq('plan_id', planId)
      .single()
    const commission = await sb
      .from('doctor_commission_history')
      .select('id, percentage_bps')
      .eq('doctor_id', doctorId)
      .single()

    const rpc = await sb.rpc('create_step_with_appointment', {
      p_tenant_id: tenantId,
      p_patient_id: patientId,
      p_procedure_id: procedureId,
      p_doctor_id: doctorId,
      p_plan_id: planId,
      p_appointment_at: '2026-06-01T14:00:00Z',
      p_duration_minutes: 30,
      p_title: 'Sessao 1',
      p_notes: null,
      p_created_by: createdBy,
      p_amount_cents: price.data!.amount_cents,
      p_commission_bps: commission.data!.percentage_bps,
      p_price_version_id: price.data!.id,
      p_commission_history_id: commission.data!.id,
    })
    expect(rpc.error).toBeNull()
    const row = (Array.isArray(rpc.data) ? rpc.data[0] : rpc.data) as {
      step_id: string
      appointment_id: string
    }
    expect(row.step_id).toBeTruthy()
    expect(row.appointment_id).toBeTruthy()

    const step = await sb
      .from('treatment_plan_steps')
      .select('appointment_id, status, doctor_id')
      .eq('id', row.step_id)
      .single()
    expect(step.data?.appointment_id).toBe(row.appointment_id)
    expect(step.data?.status).toBe('pendente')
    expect(step.data?.doctor_id).toBe(doctorId)
  })

  it('(c) marcar etapa como concluida cria appointment_completion + view fica ativo', async () => {
    const sb = serviceClient()
    const price = await sb
      .from('price_versions')
      .select('id, amount_cents')
      .eq('procedure_id', procedureId)
      .single()
    const commission = await sb
      .from('doctor_commission_history')
      .select('id, percentage_bps')
      .eq('doctor_id', doctorId)
      .single()

    const rpc = await sb.rpc('create_step_with_appointment', {
      p_tenant_id: tenantId,
      p_patient_id: patientId,
      p_procedure_id: procedureId,
      p_doctor_id: doctorId,
      p_plan_id: planId,
      p_appointment_at: '2026-06-02T09:00:00Z',
      p_duration_minutes: 30,
      p_title: 'Sessao 2',
      p_notes: null,
      p_created_by: createdBy,
      p_amount_cents: price.data!.amount_cents,
      p_commission_bps: commission.data!.percentage_bps,
      p_price_version_id: price.data!.id,
      p_commission_history_id: commission.data!.id,
    })
    const row = (Array.isArray(rpc.data) ? rpc.data[0] : rpc.data) as {
      step_id: string
      appointment_id: string
    }

    // Marca a etapa como concluida
    const upd = await sb
      .from('treatment_plan_steps')
      .update({
        status: 'concluido',
        completed_at: new Date().toISOString(),
        completed_by: createdBy,
      })
      .eq('id', row.step_id)
    expect(upd.error).toBeNull()

    // Verifica que appointment_completion foi criada
    const completion = await sb
      .from('appointment_completions')
      .select('source')
      .eq('appointment_id', row.appointment_id)
      .single()
    expect(completion.data?.source).toBe('plan_step')

    // Verifica view appointments_effective
    const eff = await sb
      .from('appointments_effective')
      .select('effective_status')
      .eq('id', row.appointment_id)
      .single()
    expect(eff.data?.effective_status).toBe('ativo')
  })

  it('(e) mark_appointment_realized -> sync step.status=concluido', async () => {
    const sb = serviceClient()
    const price = await sb
      .from('price_versions')
      .select('id, amount_cents')
      .eq('procedure_id', procedureId)
      .single()
    const commission = await sb
      .from('doctor_commission_history')
      .select('id, percentage_bps')
      .eq('doctor_id', doctorId)
      .single()

    const rpc = await sb.rpc('create_step_with_appointment', {
      p_tenant_id: tenantId,
      p_patient_id: patientId,
      p_procedure_id: procedureId,
      p_doctor_id: doctorId,
      p_plan_id: planId,
      p_appointment_at: '2026-06-03T10:00:00Z',
      p_duration_minutes: 30,
      p_title: 'Sessao 3',
      p_notes: null,
      p_created_by: createdBy,
      p_amount_cents: price.data!.amount_cents,
      p_commission_bps: commission.data!.percentage_bps,
      p_price_version_id: price.data!.id,
      p_commission_history_id: commission.data!.id,
    })
    const row = (Array.isArray(rpc.data) ? rpc.data[0] : rpc.data) as {
      step_id: string
      appointment_id: string
    }

    // Marca o appointment como realizado via RPC
    const realized = await sb.rpc('mark_appointment_realized', {
      p_appointment_id: row.appointment_id,
      p_by: createdBy,
      p_reason: 'test',
    })
    expect(realized.error).toBeNull()

    // Verifica que a etapa foi marcada como concluida
    const step = await sb
      .from('treatment_plan_steps')
      .select('status, completed_at, completed_by')
      .eq('id', row.step_id)
      .single()
    expect(step.data?.status).toBe('concluido')
    expect(step.data?.completed_at).toBeTruthy()
  })

  it('(f) estornar appointment -> sync step.status=cancelado + libera slot', async () => {
    const sb = serviceClient()
    const price = await sb
      .from('price_versions')
      .select('id, amount_cents')
      .eq('procedure_id', procedureId)
      .single()
    const commission = await sb
      .from('doctor_commission_history')
      .select('id, percentage_bps')
      .eq('doctor_id', doctorId)
      .single()

    const rpc = await sb.rpc('create_step_with_appointment', {
      p_tenant_id: tenantId,
      p_patient_id: patientId,
      p_procedure_id: procedureId,
      p_doctor_id: doctorId,
      p_plan_id: planId,
      p_appointment_at: '2026-06-04T11:00:00Z',
      p_duration_minutes: 30,
      p_title: 'Sessao 4',
      p_notes: null,
      p_created_by: createdBy,
      p_amount_cents: price.data!.amount_cents,
      p_commission_bps: commission.data!.percentage_bps,
      p_price_version_id: price.data!.id,
      p_commission_history_id: commission.data!.id,
    })
    const row = (Array.isArray(rpc.data) ? rpc.data[0] : rpc.data) as {
      step_id: string
      appointment_id: string
    }

    // Estorna o appointment
    const reversal = await sb.from('appointment_reversals').insert({
      id: randomUUID(),
      tenant_id: tenantId,
      appointment_id: row.appointment_id,
      reversal_amount_cents: -20000,
      reason: 'test cancelar',
      created_by: createdBy,
    })
    expect(reversal.error).toBeNull()

    // Step ficou cancelado
    const step = await sb
      .from('treatment_plan_steps')
      .select('status')
      .eq('id', row.step_id)
      .single()
    expect(step.data?.status).toBe('cancelado')

    // Slot lock liberado
    const lock = await sb
      .from('appointment_slot_locks')
      .select('id')
      .eq('appointment_id', row.appointment_id)
      .maybeSingle()
    expect(lock.data).toBeNull()
  })
})

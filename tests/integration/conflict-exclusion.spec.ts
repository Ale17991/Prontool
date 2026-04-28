/**
 * Integration test do veto de conflito (US1).
 *
 * Cobre todos os cenarios de aceitacao da spec:
 *   (a) race — N INSERTs concorrentes no mesmo slot do mesmo doctor → 1 sucesso, N-1 falhas 23P01
 *   (b) back-to-back — 14:00–14:30 e 14:30–15:00 mesmo doctor → ambos OK
 *   (c) doctors diferentes mesmo slot → ambos OK
 *   (d) cross-tenant — implicito (doctor pertence a um tenant)
 *   (e) estorno + rebooking — estornar libera o slot
 *   (f) trigger libera slot_lock automaticamente
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
  seedAppointment,
  seedPatient,
} from '@/tests/helpers/seed-factories'

describe('conflict exclusion (US1)', () => {
  let tenantId: string
  let patientId: string
  let procedureId: string
  let planId: string
  let priceVersionId: string
  let doctorAId: string
  let doctorACommissionId: string
  let doctorBId: string
  let doctorBCommissionId: string

  beforeAll(async () => {
    await resetDatabase()
    const tenant = await seedTenant()
    tenantId = tenant.tenantId
    await seedTussCode('10101012')
    procedureId = await seedProcedure(tenantId, '10101012')
    planId = await seedHealthPlan(tenantId)
    priceVersionId = await seedPriceVersion({
      tenantId,
      procedureId,
      planId,
      amountCents: 20000,
      validFrom: '2020-01-01',
    })
    const a = await seedDoctor(tenantId, { crm: 'CRM-A' })
    const b = await seedDoctor(tenantId, { crm: 'CRM-B' })
    doctorAId = a.doctorId
    doctorACommissionId = a.commissionId
    doctorBId = b.doctorId
    doctorBCommissionId = b.commissionId
    patientId = await seedPatient(tenantId)
  })

  function makeAppointmentArgs(at: string, doctorId: string, commissionId: string, durationMinutes = 30) {
    return {
      tenantId,
      patientId,
      doctorId,
      procedureId,
      planId,
      priceVersionId,
      commissionId,
      amountCents: 20000,
      commissionBps: 1000,
      at,
      durationMinutes,
    }
  }

  // Helper local — seedAppointment do repo nao aceita duration_minutes,
  // entao usamos service client direto.
  async function insertAppointment(at: string, doctorId: string, commissionId: string, durationMinutes = 30) {
    const sb = serviceClient()
    const id = randomUUID()
    const { error } = await sb.from('appointments').insert({
      id,
      tenant_id: tenantId,
      patient_id: patientId,
      doctor_id: doctorId,
      procedure_id: procedureId,
      plan_id: planId,
      frozen_amount_cents: 20000,
      frozen_commission_bps: 1000,
      source_price_version_id: priceVersionId,
      source_commission_history_id: commissionId,
      appointment_at: at,
      duration_minutes: durationMinutes,
    })
    if (error) return { id: null, error }
    return { id, error: null }
  }

  it('back-to-back appointments (14:00–14:30 + 14:30–15:00) BOTH succeed', async () => {
    await resetDatabase()
    Object.assign(globalThis, {}) // no-op to keep TS happy if unused
    const tenant = await seedTenant()
    const localTenantId = tenant.tenantId
    await seedTussCode('10101012')
    const localProcedure = await seedProcedure(localTenantId, '10101012')
    const localPlan = await seedHealthPlan(localTenantId)
    const localPrice = await seedPriceVersion({
      tenantId: localTenantId,
      procedureId: localProcedure,
      planId: localPlan,
      amountCents: 20000,
      validFrom: '2020-01-01',
    })
    const localDoctor = await seedDoctor(localTenantId, { crm: 'CRM-LOCAL' })
    const localPatient = await seedPatient(localTenantId)

    const sb = serviceClient()
    const r1 = await sb.from('appointments').insert({
      id: randomUUID(),
      tenant_id: localTenantId,
      patient_id: localPatient,
      doctor_id: localDoctor.doctorId,
      procedure_id: localProcedure,
      plan_id: localPlan,
      frozen_amount_cents: 20000,
      frozen_commission_bps: 1000,
      source_price_version_id: localPrice,
      source_commission_history_id: localDoctor.commissionId,
      appointment_at: '2026-05-04T14:00:00Z',
      duration_minutes: 30,
    })
    const r2 = await sb.from('appointments').insert({
      id: randomUUID(),
      tenant_id: localTenantId,
      patient_id: localPatient,
      doctor_id: localDoctor.doctorId,
      procedure_id: localProcedure,
      plan_id: localPlan,
      frozen_amount_cents: 20000,
      frozen_commission_bps: 1000,
      source_price_version_id: localPrice,
      source_commission_history_id: localDoctor.commissionId,
      appointment_at: '2026-05-04T14:30:00Z',
      duration_minutes: 30,
    })

    expect(r1.error).toBeNull()
    expect(r2.error).toBeNull()

    // Repopula o set de globals do beforeAll para os proximos testes que dependem dele.
    tenantId = localTenantId
    procedureId = localProcedure
    planId = localPlan
    priceVersionId = localPrice
    doctorAId = localDoctor.doctorId
    doctorACommissionId = localDoctor.commissionId
    patientId = localPatient
    const b = await seedDoctor(localTenantId, { crm: 'CRM-B-2' })
    doctorBId = b.doctorId
    doctorBCommissionId = b.commissionId
  })

  it('overlapping appointments for SAME doctor are rejected (23P01)', async () => {
    const r1 = await insertAppointment('2026-05-05T09:00:00Z', doctorAId, doctorACommissionId, 30)
    expect(r1.error).toBeNull()

    const r2 = await insertAppointment('2026-05-05T09:15:00Z', doctorAId, doctorACommissionId, 30)
    expect(r2.error).not.toBeNull()
    expect(r2.error?.message).toMatch(/APPOINTMENT_CONFLICT|exclusion/i)
  })

  it('same slot for DIFFERENT doctors both succeed', async () => {
    const r1 = await insertAppointment('2026-05-06T10:00:00Z', doctorAId, doctorACommissionId, 30)
    const r2 = await insertAppointment('2026-05-06T10:00:00Z', doctorBId, doctorBCommissionId, 30)
    expect(r1.error).toBeNull()
    expect(r2.error).toBeNull()
  })

  it('reversed appointment frees the slot for rebooking', async () => {
    const apt1 = await insertAppointment('2026-05-07T11:00:00Z', doctorAId, doctorACommissionId, 30)
    expect(apt1.error).toBeNull()

    // Estorna
    const sb = serviceClient()
    const reversal = await sb.from('appointment_reversals').insert({
      id: randomUUID(),
      tenant_id: tenantId,
      appointment_id: apt1.id!,
      reversal_amount_cents: -20000,
      reason: 'test rebooking',
      created_by: randomUUID(),
    })
    expect(reversal.error).toBeNull()

    // Slot lock removido pelo trigger
    const lockCheck = await sb
      .from('appointment_slot_locks')
      .select('id')
      .eq('appointment_id', apt1.id!)
      .maybeSingle()
    expect(lockCheck.data).toBeNull()

    // Novo agendamento mesmo slot mesmo doctor → sucesso
    const apt2 = await insertAppointment('2026-05-07T11:00:00Z', doctorAId, doctorACommissionId, 30)
    expect(apt2.error).toBeNull()
  })

  it('race condition: 10 concurrent inserts in same slot → exactly 1 succeeds', async () => {
    const inserts = await Promise.all(
      Array.from({ length: 10 }).map(() =>
        insertAppointment('2026-05-08T13:00:00Z', doctorAId, doctorACommissionId, 30),
      ),
    )
    const successes = inserts.filter((r) => r.error === null)
    const conflicts = inserts.filter(
      (r) => r.error !== null && /APPOINTMENT_CONFLICT|exclusion/i.test(r.error?.message ?? ''),
    )
    expect(successes).toHaveLength(1)
    expect(conflicts).toHaveLength(9)
    // sem outros tipos de erro
    expect(successes.length + conflicts.length).toBe(10)
  })
})

/**
 * Feature: quantidade por linha de appointment_procedures (migration 0081).
 *
 * line_amount_cents continua sendo UNITARIO. Total da linha =
 * line_amount_cents * quantity. RPC create_appointment_with_procedures_and_materials
 * faz a multiplicacao no calculo de frozen_amount_cents, e os reportes
 * (summaryByPlan / financial-report.aggregateByPlanFromLines / by-professional)
 * tambem multiplicam por quantity.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import {
  seedTenant,
  seedTussCode,
  seedProcedure,
  seedHealthPlan,
  seedDoctor,
  seedPriceVersion,
  seedPatient,
  seedAppointment,
} from '@/tests/helpers/seed-factories'
import { summaryByPlan } from '@/lib/core/reports/by-plan'
import { seedAppointmentLineAndComplete } from './_helpers/seed-appointment-procedure'

const TUSS = '10101095'

describe('appointment_procedures.quantity — migration 0081', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('linha com quantity=3 conta 3 procedimentos e receita = unit*3 no summary', async () => {
    const { tenantId } = await seedTenant('qty-rep')
    await seedTussCode(TUSS)
    const procedureId = await seedProcedure(tenantId, TUSS)
    const planId = await seedHealthPlan(tenantId, 'Plan-Q')
    const doc = await seedDoctor(tenantId, { crm: 'DOC-Q', bps: 0 })
    const pv = await seedPriceVersion({
      tenantId,
      procedureId,
      planId,
      amountCents: 10000, // R$ 100,00 unitario
      validFrom: '2020-01-01',
    })
    const patient = await seedPatient(tenantId)
    const aptId = await seedAppointment({
      tenantId,
      patientId: patient,
      doctorId: doc.doctorId,
      procedureId,
      planId,
      priceVersionId: pv,
      commissionId: doc.commissionId,
      amountCents: 30000, // frozen_amount_cents = total (3 * 100)
      commissionBps: 0,
      at: '2026-05-10T10:00:00Z',
    })
    const sb = serviceClient()
    // Insert direto na tabela para forçar quantity=3 (o helper nao expoe qty).
    await sb
      .from('appointment_procedures')
      .insert({
        tenant_id: tenantId,
        appointment_id: aptId,
        procedure_id: procedureId,
        plan_id: planId,
        source_price_version_id: pv,
        line_amount_cents: 10000, // UNITARIO
        vigente_amount_cents: 10000,
        amount_was_overridden: false,
        sequence: 1,
        quantity: 3,
        created_by: '00000000-0000-0000-0000-000000000001',
      })
      .throwOnError()
    // Completion → ativo na view.
    await sb
      .from('appointment_completions')
      .insert({
        tenant_id: tenantId,
        appointment_id: aptId,
        completed_by: '00000000-0000-0000-0000-000000000001',
        source: 'manual',
        reason: 'seed',
      })
      .throwOnError()

    const summary = await summaryByPlan(sb, {
      tenantId,
      from: '2026-05-01',
      to: '2026-05-31',
    })
    const row = summary.find((r) => r.planId === planId)
    expect(row).toBeDefined()
    // qty=3, unit=10000 → 3 procedimentos, R$ 300,00 (30000 cents).
    expect(row!.procedureCount).toBe(3)
    expect(row!.totalRevenueCents).toBe(30000)
  })

  it('linha sem quantity (compat backfill) usa default 1 e funciona como antes', async () => {
    const { tenantId } = await seedTenant('qty-default')
    await seedTussCode(TUSS)
    const procedureId = await seedProcedure(tenantId, TUSS)
    const planId = await seedHealthPlan(tenantId, 'Plan-Compat')
    const doc = await seedDoctor(tenantId, { crm: 'DOC-C', bps: 0 })
    const pv = await seedPriceVersion({
      tenantId,
      procedureId,
      planId,
      amountCents: 25000,
      validFrom: '2020-01-01',
    })
    const patient = await seedPatient(tenantId)
    const aptId = await seedAppointment({
      tenantId,
      patientId: patient,
      doctorId: doc.doctorId,
      procedureId,
      planId,
      priceVersionId: pv,
      commissionId: doc.commissionId,
      amountCents: 25000,
      commissionBps: 0,
      at: '2026-05-12T10:00:00Z',
    })
    const sb = serviceClient()
    // helper nao seta quantity → DB aplica DEFAULT 1.
    await seedAppointmentLineAndComplete(sb, {
      tenantId,
      appointmentId: aptId,
      procedureId,
      planId,
      priceVersionId: pv,
      amountCents: 25000,
    })

    // Lê a linha de volta — quantity deve ser 1.
    const { data: lineRow } = await sb
      .from('appointment_procedures')
      .select('quantity, line_amount_cents')
      .eq('appointment_id', aptId)
      .single()
    expect((lineRow as { quantity: number } | null)?.quantity).toBe(1)

    const summary = await summaryByPlan(sb, {
      tenantId,
      from: '2026-05-01',
      to: '2026-05-31',
    })
    const row = summary.find((r) => r.planId === planId)
    expect(row?.procedureCount).toBe(1)
    expect(row?.totalRevenueCents).toBe(25000)
  })

  it('CHECK constraint impede quantity=0', async () => {
    const { tenantId } = await seedTenant('qty-zero')
    await seedTussCode(TUSS)
    const procedureId = await seedProcedure(tenantId, TUSS)
    const planId = await seedHealthPlan(tenantId, 'Plan-Zero')
    const doc = await seedDoctor(tenantId, { crm: 'DOC-Z', bps: 0 })
    const pv = await seedPriceVersion({
      tenantId,
      procedureId,
      planId,
      amountCents: 10000,
      validFrom: '2020-01-01',
    })
    const patient = await seedPatient(tenantId)
    const aptId = await seedAppointment({
      tenantId,
      patientId: patient,
      doctorId: doc.doctorId,
      procedureId,
      planId,
      priceVersionId: pv,
      commissionId: doc.commissionId,
      amountCents: 10000,
      commissionBps: 0,
      at: '2026-05-14T10:00:00Z',
    })
    const sb = serviceClient()
    const res = await sb.from('appointment_procedures').insert({
      tenant_id: tenantId,
      appointment_id: aptId,
      procedure_id: procedureId,
      plan_id: planId,
      source_price_version_id: pv,
      line_amount_cents: 10000,
      vigente_amount_cents: 10000,
      amount_was_overridden: false,
      sequence: 1,
      quantity: 0, // <-- viola CHECK > 0
      created_by: '00000000-0000-0000-0000-000000000001',
    })
    expect(res.error).not.toBeNull()
    expect(String(res.error?.message ?? '')).toMatch(/quantity/)
  })
})

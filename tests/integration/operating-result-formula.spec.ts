/**
 * T054 (Feature 013) — fórmula resultado operacional.
 *
 * gross_revenue − commissions − fixed_payments − liberal_payments
 *               − taxes − operating_expenses = net_profit
 *
 * Cenário controlado: 1 atendimento ativo (gross 10000, commission 30%),
 * 1 doctor Fixo (mensal 5000, dia 1), 1 assistente Liberal (3500), 1
 * expense imposto (1000) e 1 expense operacional (500).
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
import { mintJwt } from '@/tests/helpers/jwt-helper'
import { computeOperatingResult } from '@/lib/core/reports/operating-result'

describe('Feature 013 — operating result formula', () => {
  let tenantId: string
  let adminJwt: string

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('op-res')).tenantId
    const admin = await seedUser(tenantId, 'admin')
    adminJwt = mintJwt({
      userId: admin.userId,
      email: admin.email,
      tenantId,
      role: 'admin',
    })
    const principal = await seedDoctor(tenantId, { bps: 3000 })
    const liberal = await seedDoctor(tenantId, { paymentMode: 'liberal', liberalDefaultCents: 3500 })
    // Fixo com billing_day=1 (sempre conta no mês corrente)
    await seedDoctor(tenantId, {
      paymentMode: 'fixo',
      monthlyAmountCents: 500000,
      billingDay: 1,
    })

    const planId = await seedHealthPlan(tenantId)
    await seedTussCode('00010099')
    const procedureId = await seedProcedure(tenantId, '00010099')
    const pv = await seedPriceVersion({
      tenantId,
      planId,
      procedureId,
      amountCents: 10000,
      validFrom: '2020-01-01',
    })
    const patientId = await seedPatient(tenantId)
    const sb = serviceClient()
    const { data: comm } = await sb
      .from('doctor_commission_history')
      .select('id')
      .eq('doctor_id', principal.doctorId)
      .single()

    // Atendimento neste mês.
    const now = new Date()
    const apptId = await seedAppointment({
      tenantId,
      doctorId: principal.doctorId,
      planId,
      procedureId,
      priceVersionId: pv,
      patientId,
      commissionId: (comm as unknown as { id: string }).id,
      amountCents: 10000,
      commissionBps: 3000,
      at: now.toISOString(),
    })

    // Linha de procedimento + completion para que appointments_effective conte.
    await sb
      .from('appointment_procedures' as never)
      .insert({
        tenant_id: tenantId,
        appointment_id: apptId,
        procedure_id: procedureId,
        plan_id: planId,
        source_price_version_id: pv,
        sequence: 1,
        line_amount_cents: 10000,
        vigente_amount_cents: 10000,
        amount_was_overridden: false,
      } as never)

    // Anexa assistente liberal.
    await sb.rpc('attach_assistant_to_appointment' as never, {
      p_appointment_id: apptId,
      p_assistant_doctor_id: liberal.doctorId,
      p_amount_cents: 3500,
      p_actor: admin.userId,
    } as never)

    // Expense imposto: precisa de tax_id válido.
    const { data: tax } = await sb
      .from('taxes' as never)
      .insert({
        tenant_id: tenantId,
        name: 'ISS',
        rate_bps: 500,
        category: 'municipal',
        created_by: admin.userId,
      } as never)
      .select('id')
      .single()
    const taxId = (tax as unknown as { id: string }).id

    const todayDate = now.toISOString().slice(0, 10)
    await sb
      .from('expenses')
      .insert([
        {
          tenant_id: tenantId,
          category: 'impostos',
          description: 'imposto ISS',
          amount_cents: 1000,
          competence_date: todayDate,
          created_by: admin.userId,
          tax_id: taxId,
        } as never,
        {
          tenant_id: tenantId,
          category: 'aluguel',
          description: 'aluguel',
          amount_cents: 500,
          competence_date: todayDate,
          created_by: admin.userId,
        } as never,
      ])
      .throwOnError()

    void adminJwt
  })

  it('Computa todos os 7 termos da fórmula', async () => {
    const sb = serviceClient()
    const now = new Date()
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const result = await computeOperatingResult(sb, { tenantId, month })

    // Gross: 10000 (1 atendimento)
    expect(result.lines.grossRevenueCents).toBe(10000)
    // Commissions: 30% de 10000 = 3000 (via net_commission_cents da view)
    expect(result.lines.commissionsCents).toBe(3000)
    // Fixed: 1 fixo × 5000 = 5000 (se hoje >= dia 1, sempre verdade)
    expect(result.lines.fixedPaymentsCents).toBe(500000)
    // Liberal: 3500 (1 assistente ativo no atendimento ativo)
    expect(result.lines.liberalPaymentsCents).toBe(3500)
    // Taxes: 1000
    expect(result.lines.taxesCents).toBe(1000)
    // Operating: 500
    expect(result.lines.operatingExpensesCents).toBe(500)
    // Net = 10000 - 3000 - 500000 - 3500 - 1000 - 500 = -498000
    expect(result.lines.netProfitCents).toBe(10000 - 3000 - 500000 - 3500 - 1000 - 500)
  })
})

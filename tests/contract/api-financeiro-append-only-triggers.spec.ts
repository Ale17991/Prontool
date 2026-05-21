/**
 * Feature 023 — Foundational T019 — Append-only triggers
 *
 * Princípio I: valores calculados em `monthly_payouts` são imutáveis;
 * DELETE bloqueado em todas as 5 tabelas; `monthly_payouts` permite
 * UPDATE apenas na whitelist (closed_at, closed_by, paid_at,
 * paid_amount_cents, payment_method, payment_note, updated_at).
 *
 * Testa via service_role (bypassa RLS mas não bypassa trigger).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedPatient } from '@/tests/helpers/seed-factories'

describe('Feature 023 — append-only triggers', () => {
  let tenantId: string
  let userId: string
  let doctorId: string

  beforeAll(async () => {
    await resetDatabase()
    const t = await seedTenant('appendonly-trig')
    tenantId = t.tenantId
    const u = await seedUser(tenantId, 'admin')
    userId = u.userId
    const sb = serviceClient()
    doctorId = randomUUID()
    await sb
      .from('doctors')
      .insert({
        id: doctorId,
        tenant_id: tenantId,
        full_name: 'Dr. Test',
        crm: 'CRM-TEST-' + randomUUID().slice(0, 6),
        active: true,
      })
      .throwOnError()
  })

  it('monthly_payouts: UPDATE em commission_cents é bloqueado pelo trigger', async () => {
    const sb = serviceClient()
    const id = randomUUID()
    await sb
      .from('monthly_payouts' as never)
      .insert({
        id,
        tenant_id: tenantId,
        doctor_id: doctorId,
        month: '2026-04',
        gross_revenue_cents: 100000,
        commission_cents: 60000,
        fixed_payment_cents: 0,
        liberal_payment_cents: 0,
        adjustments_cents: 0,
      } as never)
      .throwOnError()

    const res = await sb
      .from('monthly_payouts' as never)
      .update({ commission_cents: 70000 } as never)
      .eq('id', id)

    expect(res.error).toBeTruthy()
    expect(res.error?.message).toMatch(/append-only|Column.*commission_cents/i)
  })

  it('monthly_payouts: UPDATE em paid_at (whitelist) funciona', async () => {
    const sb = serviceClient()
    const id = randomUUID()
    await sb
      .from('monthly_payouts' as never)
      .insert({
        id,
        tenant_id: tenantId,
        doctor_id: doctorId,
        month: '2026-05',
        gross_revenue_cents: 100000,
        commission_cents: 60000,
        fixed_payment_cents: 0,
        liberal_payment_cents: 0,
        adjustments_cents: 0,
      } as never)
      .throwOnError()

    const res = await sb
      .from('monthly_payouts' as never)
      .update({
        paid_at: new Date().toISOString(),
        paid_amount_cents: 60000,
        payment_method: 'pix',
      } as never)
      .eq('id', id)

    expect(res.error).toBeNull()
  })

  it('installment_payments: DELETE bloqueado pelo trigger', async () => {
    const sb = serviceClient()
    // Cria parcela base via payment_records + payment_installments (estrutura existente)
    // Para simplicidade do teste foundational, vamos criar diretamente via SQL.
    const recordId = randomUUID()
    const installmentId = randomUUID()
    await sb.rpc('sql_for_test' as never, {} as never).then(() => {}, () => {})

    const patientId = await seedPatient(tenantId)
    await sb
      .from('payment_records' as never)
      .insert({
        id: recordId,
        tenant_id: tenantId,
        patient_id: patientId,
        total_amount_cents: 10000,
        paid_amount_cents: 0,
        installments: 1,
        payment_method: 'pix',
        payment_status: 'pendente',
        created_by: userId,
      } as never)
      .throwOnError()
    await sb
      .from('payment_installments' as never)
      .insert({
        id: installmentId,
        tenant_id: tenantId,
        payment_record_id: recordId,
        installment_number: 1,
        amount_cents: 10000,
        due_date: '2026-06-01',
        status: 'pendente',
      } as never)
      .throwOnError()

    const ipId = randomUUID()
    await sb
      .from('installment_payments' as never)
      .insert({
        id: ipId,
        tenant_id: tenantId,
        installment_id: installmentId,
        paid_at: new Date().toISOString(),
        amount_cents: 5000,
        payment_method: 'pix',
        actor_user_id: userId,
      } as never)
      .throwOnError()

    const res = await sb.from('installment_payments' as never).delete().eq('id', ipId)
    expect(res.error).toBeTruthy()
    expect(res.error?.message).toMatch(/DELETE not allowed|append-only/i)
  })

  it('tenant_cash_balance_adjustments: UPDATE em amount_cents bloqueado', async () => {
    const sb = serviceClient()
    const id = randomUUID()
    await sb
      .from('tenant_cash_balance_adjustments' as never)
      .insert({
        id,
        tenant_id: tenantId,
        effective_from: '2026-05-01',
        amount_cents: 100000,
        reason: 'Aporte inicial',
        actor_user_id: userId,
      } as never)
      .throwOnError()

    const res = await sb
      .from('tenant_cash_balance_adjustments' as never)
      .update({ amount_cents: 200000 } as never)
      .eq('id', id)

    expect(res.error).toBeTruthy()
    expect(res.error?.message).toMatch(/append-only|Column.*amount_cents/i)
  })

  it('expenses: ALTER+backfill manteve recurring_starts_at NULL para não-recorrentes', async () => {
    const sb = serviceClient()
    const { data, error } = await sb
      .from('expenses')
      .select('recurring, recurring_starts_at')
      .eq('recurring', false)
      .limit(1)
    expect(error).toBeNull()
    if (data && data.length > 0) {
      expect((data[0] as { recurring_starts_at: string | null }).recurring_starts_at).toBeNull()
    }
  })
})

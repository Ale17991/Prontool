/**
 * Feature 023 — Foundational T021 — Trigger refresh_installment_paid_cache
 *
 * Múltiplos pagamentos parciais inseridos em `installment_payments` devem
 * acumular em `payment_installments.paid_amount_cents` via trigger.
 * Status deve transitar pendente → parcial → pago corretamente.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedPatient } from '@/tests/helpers/seed-factories'

describe('Feature 023 — refresh_installment_paid_cache trigger', () => {
  let tenantId: string
  let userId: string
  let installmentId: string

  beforeAll(async () => {
    await resetDatabase()
    const t = await seedTenant('cache-trig')
    tenantId = t.tenantId
    const u = await seedUser(tenantId, 'financeiro')
    userId = u.userId

    const patientId = await seedPatient(tenantId)
    const sb = serviceClient()
    const recordId = randomUUID()
    installmentId = randomUUID()
    await sb
      .from('payment_records' as never)
      .insert({
        id: recordId,
        tenant_id: tenantId,
        patient_id: patientId,
        total_amount_cents: 60000,
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
        amount_cents: 60000,
        due_date: '2026-06-01',
        status: 'pendente',
        paid_amount_cents: 0,
      } as never)
      .throwOnError()
  })

  async function recordPartial(amountCents: number, paidAtIso: string): Promise<void> {
    const sb = serviceClient()
    await sb
      .from('installment_payments' as never)
      .insert({
        tenant_id: tenantId,
        installment_id: installmentId,
        paid_at: paidAtIso,
        amount_cents: amountCents,
        payment_method: 'pix',
        actor_user_id: userId,
      } as never)
      .throwOnError()
  }

  async function readInstallment(): Promise<{
    paid_amount_cents: number
    status: string
    paid_at: string | null
  }> {
    const sb = serviceClient()
    const { data, error } = await sb
      .from('payment_installments' as never)
      .select('paid_amount_cents, status, paid_at')
      .eq('id', installmentId)
      .single()
    expect(error).toBeNull()
    return data as never
  }

  it('1º pagamento parcial → status=parcial, paid_amount=20000', async () => {
    await recordPartial(20000, '2026-05-10T10:00:00Z')
    const row = await readInstallment()
    expect(row.paid_amount_cents).toBe(20000)
    expect(row.status).toBe('parcial')
    expect(row.paid_at).toBe('2026-05-10T10:00:00+00:00')
  })

  it('2º pagamento parcial → status=parcial, paid_amount=40000, paid_at do mais recente', async () => {
    await recordPartial(20000, '2026-05-12T11:00:00Z')
    const row = await readInstallment()
    expect(row.paid_amount_cents).toBe(40000)
    expect(row.status).toBe('parcial')
    expect(row.paid_at).toBe('2026-05-12T11:00:00+00:00')
  })

  it('3º pagamento parcial fechando total → status=pago, paid_amount=60000', async () => {
    await recordPartial(20000, '2026-05-15T09:00:00Z')
    const row = await readInstallment()
    expect(row.paid_amount_cents).toBe(60000)
    expect(row.status).toBe('pago')
  })

  it('estorno (amount negativo) reduz paid_amount → status volta a parcial', async () => {
    await recordPartial(-20000, '2026-05-20T10:00:00Z')
    const row = await readInstallment()
    expect(row.paid_amount_cents).toBe(40000)
    expect(row.status).toBe('parcial')
  })
})

/**
 * Regressão do fix C4 — Trigger BEFORE INSERT em
 * doctor_payment_terms_history valida `doctors.tenant_id = NEW.tenant_id`.
 *
 * Antes: a tabela tinha FK pra doctors, mas sem CHECK ou trigger
 * validando consistência. Podia gravar uma row com tenant_id=A e
 * doctor_id pertencente ao tenant B — inconsistência silenciosa
 * (relatórios filtram por tenant_id da row, doctor real pertencia
 * a outro tenant).
 *
 * Agora (0086): trigger check_payment_terms_tenant_consistency rejeita
 * com PAYMENT_TERMS_TENANT_MISMATCH antes do INSERT.
 *
 * Como o trigger roda independente de quem está chamando (BEFORE INSERT
 * é universal), testamos via service_role para isolar o trigger.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedDoctor } from '@/tests/helpers/seed-factories'

describe('security: doctor_payment_terms tenant consistency (C4)', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('INSERT com tenant_id divergente de doctors.tenant_id → trigger rejeita', async () => {
    const { tenantId: tenantA } = await seedTenant('c4-tenant-a')
    const { tenantId: tenantB } = await seedTenant('c4-tenant-b')
    // Doctor pertence ao tenant B.
    const { doctorId } = await seedDoctor(tenantB, { paymentMode: 'comissionado' })

    const sb = serviceClient()
    // Tenta gravar history com tenant_id=A mas doctor_id do tenant B.
    const { error } = await sb
      .from('doctor_payment_terms_history')
      .insert({
        tenant_id: tenantA, // ← divergente de doctors.tenant_id (B)
        doctor_id: doctorId,
        payment_mode: 'comissionado',
        percentage_bps: 5000,
        monthly_amount_cents: null,
        billing_day: null,
        liberal_default_cents: null,
        valid_from: '2026-01-01',
        reason: 'tentativa cross-tenant',
        created_by: '00000000-0000-0000-0000-000000000000',
      } as never)

    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/PAYMENT_TERMS_TENANT_MISMATCH/)
  })

  it('INSERT com tenant_id consistente (mesmo de doctors) → sucesso', async () => {
    const { tenantId } = await seedTenant('c4-tenant-ok')
    const { doctorId } = await seedDoctor(tenantId, { paymentMode: 'comissionado' })

    const sb = serviceClient()
    const { error } = await sb
      .from('doctor_payment_terms_history')
      .insert({
        tenant_id: tenantId,
        doctor_id: doctorId,
        payment_mode: 'comissionado',
        percentage_bps: 5500,
        monthly_amount_cents: null,
        billing_day: null,
        liberal_default_cents: null,
        valid_from: '2026-02-01',
        reason: 'ajuste legítimo',
        created_by: '00000000-0000-0000-0000-000000000000',
      } as never)

    expect(error).toBeNull()
  })

  it('INSERT com doctor_id inexistente → trigger raise NOT_FOUND (23503)', async () => {
    const { tenantId } = await seedTenant('c4-doctor-missing')
    const sb = serviceClient()
    const { error } = await sb
      .from('doctor_payment_terms_history')
      .insert({
        tenant_id: tenantId,
        doctor_id: '00000000-0000-0000-0000-000000000123',
        payment_mode: 'comissionado',
        percentage_bps: 4000,
        monthly_amount_cents: null,
        billing_day: null,
        liberal_default_cents: null,
        valid_from: '2026-01-01',
        reason: 'doctor inexistente',
        created_by: '00000000-0000-0000-0000-000000000000',
      } as never)

    // FK fires antes do trigger custom; aceita qualquer um dos dois shapes.
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/nao encontrado|violates foreign key/i)
  })
})

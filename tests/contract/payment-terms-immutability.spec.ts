/**
 * T007 (Feature 013) — `doctor_payment_terms_history` é append-only stricto.
 *
 * Constitution Principle I: UPDATE e DELETE em authenticated devem ser
 * bloqueados pelo trigger `enforce_payment_terms_immutable`. service_role
 * passa (usado pelas RPCs SECURITY DEFINER).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, rlsClient, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedDoctor } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

describe('Feature 013 — doctor_payment_terms_history append-only', () => {
  let tenantId: string
  let adminJwt: string
  let rowId: string

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('pt-imm')).tenantId
    const admin = await seedUser(tenantId, 'admin')
    adminJwt = mintJwt({
      userId: admin.userId,
      email: admin.email,
      tenantId,
      role: 'admin',
    })
    const { doctorId } = await seedDoctor(tenantId)
    const sb = serviceClient()
    const { data, error } = await sb
      .from('doctor_payment_terms_history' as never)
      .select('id')
      .eq('doctor_id', doctorId)
      .single()
    if (error) throw new Error(`fetch seeded row: ${error.message}`)
    rowId = (data as unknown as { id: string }).id
  })

  it('authenticated NÃO pode UPDATE em doctor_payment_terms_history', async () => {
    const rls = rlsClient(adminJwt)
    const { error } = await rls
      .from('doctor_payment_terms_history' as never)
      .update({ reason: 'tentativa hack' } as never)
      .eq('id', rowId)
    // RLS pode bloquear silenciosamente (0 rows affected) OU o trigger pode
    // levantar. Em ambos os casos a row não deve mudar.
    if (error) {
      expect(error.message).toMatch(/append-only|policy|permission|denied/i)
    }
    const sb = serviceClient()
    const { data } = await sb
      .from('doctor_payment_terms_history' as never)
      .select('reason')
      .eq('id', rowId)
      .single()
    expect((data as unknown as { reason: string }).reason).not.toBe('tentativa hack')
  })

  it('authenticated NÃO pode DELETE em doctor_payment_terms_history', async () => {
    const rls = rlsClient(adminJwt)
    const { error } = await rls
      .from('doctor_payment_terms_history' as never)
      .delete()
      .eq('id', rowId)
    // Idem — RLS ou trigger bloqueiam; row continua existindo.
    if (error) {
      expect(error.message).toMatch(/append-only|policy|permission|denied/i)
    }
    const sb = serviceClient()
    const { data } = await sb
      .from('doctor_payment_terms_history' as never)
      .select('id')
      .eq('id', rowId)
      .maybeSingle()
    expect(data).not.toBeNull()
  })
})

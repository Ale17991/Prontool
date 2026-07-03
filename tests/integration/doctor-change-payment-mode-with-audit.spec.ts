/**
 * T015 (Feature 013) — mudança de modalidade gera nova versão em history,
 * espelha em doctors.payment_mode e produz audit log.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedDoctor } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

describe('Feature 013 — mudança de modalidade com audit', () => {
  let tenantId: string
  let adminJwt: string
  let adminId: string
  let doctorId: string

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('chg-pm')).tenantId
    const admin = await seedUser(tenantId, 'admin')
    adminId = admin.userId
    adminJwt = mintJwt({
      userId: admin.userId,
      email: admin.email,
      tenantId,
      role: 'admin',
    })
    const { doctorId: d } = await seedDoctor(tenantId, { bps: 3000 })
    doctorId = d
  })

  it('PATCH com payment_mode_change: comissionado → fixo', async () => {
    const { PATCH } = await import('@/app/api/medicos/[id]/route')
    const validFrom = new Date().toISOString().slice(0, 10)
    const res = await PATCH(
      new Request(`http://localhost/api/medicos/${doctorId}`, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${adminJwt}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          payment_mode_change: {
            payment_mode: 'fixo',
            monthly_amount_cents: 1200000,
            billing_day: 10,
            valid_from: validFrom,
            reason: 'Mudança para regime CLT',
          },
        }),
      }),
      { params: { id: doctorId } },
    )
    expect(res.status).toBe(200)

    const sb = serviceClient()

    // 1) Nova versão em history (>= 2 rows: a inicial do seed + a nova)
    const { data: history } = await sb
      .from('doctor_payment_terms_history' as never)
      .select('payment_mode, monthly_amount_cents, valid_from, reason')
      .eq('doctor_id', doctorId)
      .order('valid_from', { ascending: false })
    const rows = history as unknown as Array<{
      payment_mode: string
      monthly_amount_cents: number | null
      valid_from: string
      reason: string
    }>
    expect(rows.length).toBeGreaterThanOrEqual(2)
    expect(rows[0]?.payment_mode).toBe('fixo')
    expect(rows[0]?.monthly_amount_cents).toBe(1200000)
    expect(rows[0]?.reason).toBe('Mudança para regime CLT')

    // 2) Doctor.payment_mode espelha o head-of-chain.
    const { data: doctor } = await sb
      .from('doctors')
      .select('payment_mode')
      .eq('id', doctorId)
      .single()
    expect((doctor as unknown as { payment_mode: string }).payment_mode).toBe('fixo')

    // 3) Audit log tem entrada com field='version_created' e reason.
    const { data: audit } = await sb
      .from('audit_log')
      .select('entity, field, reason, new_value, timestamp_utc')
      .eq('entity', 'doctor_payment_terms')
      .eq('reason', 'Mudança para regime CLT')
      .order('timestamp_utc', { ascending: false })
      .limit(1)
    const auditRow = (audit ?? [])[0] as unknown as
      | {
          entity: string
          field: string
          reason: string | null
        }
      | undefined
    expect(auditRow).toBeDefined()
    expect(auditRow!.field).toBe('version_created')
    expect(auditRow!.reason).toBe('Mudança para regime CLT')

    void adminId
  })

  it('PATCH rejeita valid_from no futuro (VALID_FROM_FUTURE)', async () => {
    const { PATCH } = await import('@/app/api/medicos/[id]/route')
    const future = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
    const res = await PATCH(
      new Request(`http://localhost/api/medicos/${doctorId}`, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${adminJwt}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          payment_mode_change: {
            payment_mode: 'liberal',
            liberal_default_cents: 35000,
            valid_from: future,
            reason: 'tentativa futuro',
          },
        }),
      }),
      { params: { id: doctorId } },
    )
    expect(res.status).toBe(400)
  })
})

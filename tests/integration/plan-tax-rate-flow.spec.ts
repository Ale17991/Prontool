/**
 * T036 (Feature 011) — fluxo completo de alíquota do convênio.
 *
 * Cobre US2 acceptance scenarios: marcar checkbox → preencher → salvar →
 * reabrir (persistido) → desmarcar → salvar (zerado).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedHealthPlan } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'
import { updatePlanTaxRate } from '@/lib/core/plans/update-tax-rate'

describe('Feature 011 — fluxo de alíquota do convênio (US2)', () => {
  let tenantId: string
  let planId: string
  let adminJwt: string

  beforeAll(async () => {
    await resetDatabase()
    const t = await seedTenant('plan-tax-flow')
    tenantId = t.tenantId
    const admin = await seedUser(tenantId, 'admin')
    adminJwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })
    planId = await seedHealthPlan(tenantId, 'Unimed-FLOW')
  })

  it('default = 0 (convênio não cobra imposto)', async () => {
    const sb = serviceClient()
    const { data } = await sb
      .from('health_plans')
      .select('tax_rate_bps')
      .eq('id', planId)
      .single()
    expect((data as { tax_rate_bps?: number } | null)?.tax_rate_bps).toBe(0)
  })

  it('marca + define 650 → persiste; resposta inclui tax_rate_percent', async () => {
    const { PATCH } = await import('@/app/api/planos/[id]/route')
    const res = await PATCH(
      new Request(`http://localhost/api/planos/${planId}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${adminJwt}`,
        },
        body: JSON.stringify({ tax_rate_bps: 650 }),
      }),
      { params: { id: planId } },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      tax_rate_bps: number
      tax_rate_percent: string
    }
    expect(body.tax_rate_bps).toBe(650)
    expect(body.tax_rate_percent).toBe('6,50')

    // Confirma persistência
    const sb = serviceClient()
    const { data } = await sb
      .from('health_plans')
      .select('tax_rate_bps')
      .eq('id', planId)
      .single()
    expect((data as { tax_rate_bps?: number } | null)?.tax_rate_bps).toBe(650)
  })

  it('desmarcar (PATCH 0) zera a alíquota', async () => {
    const { PATCH } = await import('@/app/api/planos/[id]/route')
    const res = await PATCH(
      new Request(`http://localhost/api/planos/${planId}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${adminJwt}`,
        },
        body: JSON.stringify({ tax_rate_bps: 0 }),
      }),
      { params: { id: planId } },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { tax_rate_bps: number }
    expect(body.tax_rate_bps).toBe(0)
  })

  it('core lib updatePlanTaxRate rejeita range inválido', async () => {
    const sb = serviceClient()
    await expect(
      updatePlanTaxRate(sb, { tenantId, planId, taxRateBps: -1 }),
    ).rejects.toThrow(/inválido/)
    await expect(
      updatePlanTaxRate(sb, { tenantId, planId, taxRateBps: 10001 }),
    ).rejects.toThrow(/inválido/)
  })

  it('PATCH com `active` continua funcionando (backward compat)', async () => {
    const { PATCH } = await import('@/app/api/planos/[id]/route')
    const res = await PATCH(
      new Request(`http://localhost/api/planos/${planId}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${adminJwt}`,
        },
        body: JSON.stringify({ active: false }),
      }),
      { params: { id: planId } },
    )
    expect(res.status).toBe(200)
  })
})

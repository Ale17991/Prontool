/**
 * T034 (Feature 011) — auditoria automática de mudanças em tax_rate_bps.
 *
 * Trigger `health_plans_tax_rate_audit AFTER UPDATE OF tax_rate_bps`
 * (migration 0076) gera linha em audit_log para cada mudança.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedHealthPlan } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

describe('Feature 011 — audit_log para mudanças em health_plans.tax_rate_bps', () => {
  let tenantId: string
  let planId: string
  let adminJwt: string

  beforeAll(async () => {
    await resetDatabase()
    const t = await seedTenant('plan-tax-audit')
    tenantId = t.tenantId
    const admin = await seedUser(tenantId, 'admin')
    adminJwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })
    planId = await seedHealthPlan(tenantId, 'Unimed-AUD')
  })

  it('PATCH tax_rate_bps 0 → 650 gera 1 linha em audit_log', async () => {
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

    const sb = serviceClient()
    const { data: audit } = await sb
      .from('audit_log')
      .select('field, old_value, new_value, reason')
      .eq('tenant_id', tenantId)
      .eq('entity', 'health_plans')
      .eq('entity_id', planId)
      .eq('field', 'tax_rate_bps')

    expect(audit).toEqual([
      {
        field: 'tax_rate_bps',
        old_value: '0',
        new_value: '650',
        reason: 'plan-tax-rate-updated',
      },
    ])
  })

  it('PATCH com mesmo valor (idempotente) NÃO gera nova linha', async () => {
    // O plan já está em 650 do teste anterior.
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

    const sb = serviceClient()
    const { data: audit } = await sb
      .from('audit_log')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('entity', 'health_plans')
      .eq('entity_id', planId)
      .eq('field', 'tax_rate_bps')

    // Continua sendo 1 — trigger usa IS DISTINCT FROM, então 650→650 não dispara.
    expect(audit?.length ?? 0).toBe(1)
  })
})

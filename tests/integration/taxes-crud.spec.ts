/**
 * T020 (Feature 011) — CRUD end-to-end de impostos da clínica + auditoria.
 *
 * Fluxo: admin cria → lista → edita rate_bps → desativa → reativa.
 * Verifica que cada operação gera linha em audit_log com entity='taxes'.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { createTax } from '@/lib/core/taxes/create'
import { listTaxes } from '@/lib/core/taxes/list'
import { updateTax } from '@/lib/core/taxes/update'

describe('Feature 011 — taxes CRUD + audit trail', () => {
  let tenantId: string
  let adminUserId: string

  beforeAll(async () => {
    await resetDatabase()
    const t = await seedTenant('taxes-crud')
    tenantId = t.tenantId
    const admin = await seedUser(tenantId, 'admin')
    adminUserId = admin.userId
  })

  it('cria, lista, edita rate, desativa, reativa — todas auditadas', async () => {
    const sb = serviceClient()

    // CREATE
    const created = await createTax(sb, {
      tenantId,
      name: 'ISS',
      rateBps: 500,
      category: 'municipal',
      description: 'ISS de Curitiba',
      actorUserId: adminUserId,
    })
    expect(created.name).toBe('ISS')
    expect(created.rate_bps).toBe(500)
    expect(created.is_active).toBe(true)

    // LIST default (apenas ativos)
    const active = await listTaxes(sb, { tenantId })
    expect(active).toHaveLength(1)
    expect(active[0]!.rate_percent).toBe('5,00')

    // UPDATE rate_bps
    const updated = await updateTax(sb, {
      tenantId,
      id: created.id,
      rateBps: 550,
    })
    expect(updated.rate_bps).toBe(550)
    expect(updated.name).toBe('ISS') // name NÃO mudou (imutável)

    // DEACTIVATE
    const deactivated = await updateTax(sb, {
      tenantId,
      id: created.id,
      isActive: false,
    })
    expect(deactivated.is_active).toBe(false)

    // LIST default agora vazia
    const stillActive = await listTaxes(sb, { tenantId })
    expect(stillActive).toHaveLength(0)
    const withInactive = await listTaxes(sb, { tenantId, includeInactive: true })
    expect(withInactive).toHaveLength(1)

    // REACTIVATE
    const reactivated = await updateTax(sb, {
      tenantId,
      id: created.id,
      isActive: true,
    })
    expect(reactivated.is_active).toBe(true)

    // Audit_log: pelo menos 4 eventos para este tax
    //   1 created
    //   1 rate_bps change
    //   1 is_active false (deactivate)
    //   1 is_active true (reactivate)
    const { data: audit } = await sb
      .from('audit_log')
      .select('field, reason, old_value, new_value')
      .eq('tenant_id', tenantId)
      .eq('entity', 'taxes')
      .eq('entity_id', created.id)
      .order('timestamp_utc', { ascending: true })

    const reasons = (audit ?? []).map((a) => a.reason)
    expect(reasons).toContain('tax-created')
    expect(reasons).toContain('tax-rate-updated')
    expect(reasons).toContain('tax-deactivated')
    expect(reasons).toContain('tax-reactivated')

    const rateAudit = (audit ?? []).find((a) => a.field === 'rate_bps')
    expect(rateAudit?.old_value).toBe('500')
    expect(rateAudit?.new_value).toBe('550')
  })
})

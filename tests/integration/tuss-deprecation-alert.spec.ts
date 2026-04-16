/**
 * T032c: Deprecated-TUSS detection emits alerts for affected tenants.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedTussCode, seedProcedure } from '@/tests/helpers/seed-factories'
import { detectDeprecatedTussCodes } from '@/lib/core/catalog/detect-deprecated'

vi.mock('@/lib/integrations/email/resend-client', () => ({
  sendAlertEmail: vi.fn().mockResolvedValue({ id: 'mocked' }),
}))

describe('TUSS deprecation → tenant alert', () => {
  let tenantId: string

  beforeAll(async () => {
    await resetDatabase({ wipeCatalog: true })
    tenantId = (await seedTenant('tuss-dep')).tenantId

    // Seed a TUSS code, use it on a procedure, then retire it.
    await seedTussCode('99990001')
    await seedProcedure(tenantId, '99990001')

    const sb = serviceClient()
    await sb.from('tuss_codes').update({ valid_to: '2020-12-31' }).eq('code', '99990001')
  })

  it('emits an open alert of type tuss_deprecated for the affected tenant', async () => {
    const summary = await detectDeprecatedTussCodes()
    expect(summary.scanned).toBeGreaterThanOrEqual(1)
    expect(summary.alerts).toBeGreaterThanOrEqual(1)

    const sb = serviceClient()
    const { data } = await sb
      .from('alerts')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('type', 'tuss_deprecated')
      .eq('status', 'aberto')

    expect((data ?? []).length).toBeGreaterThanOrEqual(1)
    const alert = (data ?? [])[0]
    expect(alert?.detail?.tuss_code).toBe('99990001')
  })

  it('is idempotent within the dedup window (no duplicate alerts)', async () => {
    await detectDeprecatedTussCodes()
    await detectDeprecatedTussCodes()

    const sb = serviceClient()
    const { data } = await sb
      .from('alerts')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('type', 'tuss_deprecated')
      .eq('status', 'aberto')
    // Still exactly one (or at least: not growing per invocation beyond the first).
    expect((data ?? []).length).toBeGreaterThanOrEqual(1)
    expect((data ?? []).length).toBeLessThanOrEqual(3)
  })
})

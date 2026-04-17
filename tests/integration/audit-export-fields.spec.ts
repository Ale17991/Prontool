/**
 * T169 — Audit export must include every FR-019 field for both csv and
 * json formats, without transformation. Generates a few audit rows
 * across different entities, then asserts the output carries the full
 * column set.
 *
 * Red-first: handler import fails until T170.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  resetDatabase,
  serviceClient,
} from '@/tests/helpers/supabase-test-client'
import {
  seedTenant,
  seedUser,
  seedTussCode,
  seedProcedure,
  seedHealthPlan,
  seedPriceVersion,
} from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

const REQUIRED_FIELDS = [
  'tenant_id',
  'actor_id',
  'actor_label',
  'timestamp_utc',
  'entity',
  'entity_id',
  'field',
  'old_value',
  'new_value',
  'reason',
  'ip',
  'user_agent',
  'result',
] as const

describe('T169 — audit export carries every FR-019 field', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('JSON export contains every required field on every row', async () => {
    const tenantId = await seedAuditableState()
    const admin = await seedUser(tenantId, 'admin', 'admin-t169-json')
    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })
    const { GET } = await import('@/app/api/auditoria/export/route')
    const res = await GET(
      new Request('http://localhost/api/auditoria/export?format=json', {
        method: 'GET',
        headers: { authorization: `Bearer ${jwt}` },
      }),
    )
    expect(res.status).toBe(200)
    const rows = (await res.json()) as Array<Record<string, unknown>>
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      for (const f of REQUIRED_FIELDS) {
        expect(row, `row missing ${f}`).toHaveProperty(f)
      }
    }
  })

  it('CSV export header lists every required field', async () => {
    const tenantId = await seedAuditableState()
    const admin = await seedUser(tenantId, 'admin', 'admin-t169-csv')
    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })
    const { GET } = await import('@/app/api/auditoria/export/route')
    const res = await GET(
      new Request('http://localhost/api/auditoria/export?format=csv', {
        method: 'GET',
        headers: { authorization: `Bearer ${jwt}` },
      }),
    )
    expect(res.status).toBe(200)
    const text = await res.text()
    const header = text.split(/\r?\n/)[0] ?? ''
    for (const f of REQUIRED_FIELDS) {
      expect(header, `header missing ${f}`).toMatch(new RegExp(`(^|,)${f}(,|$)`))
    }
  })
})

async function seedAuditableState(): Promise<string> {
  const sb = serviceClient()
  const { tenantId } = await seedTenant(`t169-${Math.random().toString(36).slice(2, 7)}`)
  await seedTussCode('10101012')
  const procedureId = await seedProcedure(tenantId, '10101012')
  const planId = await seedHealthPlan(tenantId, 'Unimed')
  // price_versions trigger writes one audit row
  await seedPriceVersion({
    tenantId,
    procedureId,
    planId,
    amountCents: 20_000,
    validFrom: '2020-01-01',
  })
  // direct audit_log row to cover a denied/conflict result
  await sb
    .from('audit_log')
    .insert({
      tenant_id: tenantId,
      entity: 'price_versions',
      result: 'denied',
      reason: 'seed deny for audit export test',
    })
    .throwOnError()
  return tenantId
}

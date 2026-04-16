/**
 * T059: Constitution Principle II validation.
 * Every INSERT on tracked tables must produce an audit_log row with
 * all required fields populated.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import {
  seedTenant,
  seedTussCode,
  seedProcedure,
  seedHealthPlan,
  seedDoctor,
} from '@/tests/helpers/seed-factories'

describe('Principle II — audit trail', () => {
  let tenantId: string
  let procedureId: string
  let planId: string
  const actorId = randomUUID()
  const actorLabel = 'user:audit-test@homio.test'

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('audit')).tenantId
    await seedTussCode('10101012')
    procedureId = await seedProcedure(tenantId, '10101012')
    planId = await seedHealthPlan(tenantId, 'Convenio X')
    await seedDoctor(tenantId)
  })

  it('price_versions INSERT emits audit_log with old/new values', async () => {
    const sb = serviceClient()

    // Set session context for trigger to pick up actor / ip / ua.
    await sb.rpc('set_config', {
      parameter: 'app.actor_id',
      value: actorId,
      is_local: false,
    } as never).catch(() => undefined)
    await sb.rpc('set_config', {
      parameter: 'app.actor_label',
      value: actorLabel,
      is_local: false,
    } as never).catch(() => undefined)

    // First version
    const firstId = randomUUID()
    await sb.from('price_versions').insert({
      id: firstId,
      tenant_id: tenantId,
      procedure_id: procedureId,
      plan_id: planId,
      amount_cents: 20000,
      valid_from: '2020-01-01',
      created_by: actorId,
      reason: 'initial',
    })

    // Second version (new chain head)
    const secondId = randomUUID()
    await sb.from('price_versions').insert({
      id: secondId,
      tenant_id: tenantId,
      procedure_id: procedureId,
      plan_id: planId,
      amount_cents: 25000,
      valid_from: '2020-06-01',
      created_by: actorId,
      reason: 'reajuste',
      previous_version_id: firstId,
    })

    const { data } = await sb
      .from('audit_log')
      .select('*')
      .eq('entity', 'price_versions')
      .eq('entity_id', secondId)

    expect(data).not.toBeNull()
    const row = data?.[0]
    expect(row).toBeDefined()
    expect(row?.tenant_id).toBe(tenantId)
    expect(row?.field).toBe('amount_cents')
    expect(row?.old_value).toBe('20000')
    expect(row?.new_value).toBe('25000')
    expect(row?.reason).toBe('reajuste')
    expect(row?.result).toBe('success')
  })
})

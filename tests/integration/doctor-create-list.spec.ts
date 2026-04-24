/**
 * T118 — createDoctor + listDoctors happy path.
 *
 * Cria um médico com comissão inicial via core, lista via listDoctors e
 * confirma que a comissão vigente é resolvida a partir do view
 * `doctor_commission_current` (FR-013).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { createDoctor } from '@/lib/core/doctors/create'
import { listDoctors } from '@/lib/core/doctors/list'

describe('T118 — doctor create + list', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('creates a doctor with initial commission and lists it with current head resolved', async () => {
    const { tenantId } = await seedTenant('t118')
    const admin = await seedUser(tenantId, 'admin')
    const sb = serviceClient()

    const created = await createDoctor(sb, {
      tenantId,
      fullName: 'Dra. Ana Carolina',
      crm: 'CRM-SP-12345',
      externalIdentifier: 'ghl-doc-001',
      initialPercentageBps: 3500,
      initialValidFrom: '2020-01-01',
      initialReason: 'contrato inicial',
      actorUserId: admin.userId,
    })

    expect(created.id).toBeDefined()
    expect(created.fullName).toBe('Dra. Ana Carolina')
    expect(created.crm).toBe('CRM-SP-12345')
    expect(created.externalIdentifier).toBe('ghl-doc-001')
    expect(created.active).toBe(true)
    expect(created.currentPercentageBps).toBe(3500)
    expect(created.currentValidFrom).toBe('2020-01-01')

    const listed = await listDoctors(sb, { tenantId })
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({
      id: created.id,
      fullName: 'Dra. Ana Carolina',
      crm: 'CRM-SP-12345',
      active: true,
      currentPercentageBps: 3500,
      currentValidFrom: '2020-01-01',
    })

    // Exactly one row in doctor_commission_history with the initial values.
    const { data: history } = await sb
      .from('doctor_commission_history')
      .select('percentage_bps, valid_from, reason')
      .eq('tenant_id', tenantId)
      .eq('doctor_id', created.id)
    expect(history).toEqual([
      { percentage_bps: 3500, valid_from: '2020-01-01', reason: 'contrato inicial' },
    ])
  })

  it('excludes inactive doctors by default and includes them with includeInactive', async () => {
    const { tenantId } = await seedTenant('t118-inactive')
    const admin = await seedUser(tenantId, 'admin')
    const sb = serviceClient()

    const active = await createDoctor(sb, {
      tenantId,
      fullName: 'Dr. Ativo',
      crm: 'CRM-01',
      initialPercentageBps: 4000,
      initialValidFrom: '2020-01-01',
      initialReason: 'inicial',
      actorUserId: admin.userId,
    })
    const toDeactivate = await createDoctor(sb, {
      tenantId,
      fullName: 'Dr. Inativo',
      crm: 'CRM-02',
      initialPercentageBps: 4000,
      initialValidFrom: '2020-01-01',
      initialReason: 'inicial',
      actorUserId: admin.userId,
    })
    await sb.from('doctors').update({ active: false }).eq('id', toDeactivate.id)

    const defaultList = await listDoctors(sb, { tenantId })
    expect(defaultList.map((d) => d.id)).toEqual([active.id])

    const allList = await listDoctors(sb, { tenantId, includeInactive: true })
    expect(allList.map((d) => d.id).sort()).toEqual([active.id, toDeactivate.id].sort())
  })
})

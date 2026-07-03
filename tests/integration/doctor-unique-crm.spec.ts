/**
 * T122 — CRM UNIQUE(tenant_id, crm). Cadastrar um segundo médico com
 * o mesmo CRM no mesmo tenant resulta em ConflictError
 * (DOCTOR_DUPLICATE, HTTP 409). Em tenants diferentes, o mesmo CRM é
 * permitido (escopo de isolamento multi-tenant).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { createDoctor } from '@/lib/core/doctors/create'
import { ConflictError } from '@/lib/observability/errors'
import { mintJwt } from '@/tests/helpers/jwt-helper'

const CRM = 'CRM-UNIQUE-99'

describe('T122 — doctor CRM uniqueness scoped to tenant', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('rejects a second doctor with the same CRM in the same tenant with DOCTOR_DUPLICATE', async () => {
    const { tenantId } = await seedTenant('t122-same')
    const admin = await seedUser(tenantId, 'admin')
    const sb = serviceClient()

    await createDoctor(sb, {
      tenantId,
      fullName: 'Dr. Primeiro',
      crm: CRM,
      initialPercentageBps: 4000,
      initialValidFrom: '2020-01-01',
      initialReason: 'inicial',
      actorUserId: admin.userId,
    })

    await expect(
      createDoctor(sb, {
        tenantId,
        fullName: 'Dr. Duplicado',
        crm: CRM,
        initialPercentageBps: 5000,
        initialValidFrom: '2020-01-01',
        initialReason: 'inicial',
        actorUserId: admin.userId,
      }),
    ).rejects.toSatisfy((err: unknown) => {
      return err instanceof ConflictError && (err as ConflictError).code === 'DOCTOR_DUPLICATE'
    })

    const { data: rows } = await sb
      .from('doctors')
      .select('id, full_name')
      .eq('tenant_id', tenantId)
      .eq('crm', CRM)
    expect(rows ?? []).toHaveLength(1)
    expect(rows?.[0]?.full_name).toBe('Dr. Primeiro')
  })

  it('allows the same CRM across different tenants', async () => {
    const a = await seedTenant('t122-a')
    const b = await seedTenant('t122-b')
    const adminA = await seedUser(a.tenantId, 'admin')
    const adminB = await seedUser(b.tenantId, 'admin')
    const sb = serviceClient()

    const docA = await createDoctor(sb, {
      tenantId: a.tenantId,
      fullName: 'Dr. Tenant A',
      crm: CRM,
      initialPercentageBps: 4000,
      initialValidFrom: '2020-01-01',
      initialReason: 'inicial',
      actorUserId: adminA.userId,
    })
    const docB = await createDoctor(sb, {
      tenantId: b.tenantId,
      fullName: 'Dr. Tenant B',
      crm: CRM,
      initialPercentageBps: 4500,
      initialValidFrom: '2020-01-01',
      initialReason: 'inicial',
      actorUserId: adminB.userId,
    })
    expect(docA.id).not.toBe(docB.id)

    const { data: rows } = await sb.from('doctors').select('tenant_id, crm').eq('crm', CRM)
    expect(rows ?? []).toHaveLength(2)
  })

  it('surfaces 409 with code=DOCTOR_DUPLICATE through POST /api/medicos', async () => {
    const { tenantId } = await seedTenant('t122-http')
    const admin = await seedUser(tenantId, 'admin')
    const sb = serviceClient()
    await createDoctor(sb, {
      tenantId,
      fullName: 'Dr. Primeiro',
      crm: CRM,
      initialPercentageBps: 4000,
      initialValidFrom: '2020-01-01',
      initialReason: 'inicial',
      actorUserId: admin.userId,
    })

    const jwt = mintJwt({
      userId: admin.userId,
      email: admin.email,
      tenantId,
      role: 'admin',
    })
    const { POST } = await import('@/app/api/medicos/route')
    const res = await POST(
      new Request('http://localhost/api/medicos', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
        body: JSON.stringify({
          full_name: 'Dr. Duplicado',
          crm: CRM,
          initial_percentage_bps: 5000,
          initial_valid_from: '2020-01-01',
          initial_reason: 'inicial',
        }),
      }),
    )
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('DOCTOR_DUPLICATE')
  })
})

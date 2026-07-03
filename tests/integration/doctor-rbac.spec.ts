/**
 * T121 — recepcionista receives 403 on POST /api/medicos and on
 * POST /api/medicos/{id}/commission; both denials are recorded in
 * audit_log with result='denied'. Valida Princípio V + FR-032.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedDoctor } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

describe('T121 — doctor/commission endpoints are gated to admin', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('recepcionista gets 403 and audit denial when creating a doctor', async () => {
    const { tenantId } = await seedTenant('t121-doc')
    const recep = await seedUser(tenantId, 'recepcionista')
    const jwt = mintJwt({
      userId: recep.userId,
      email: recep.email,
      tenantId,
      role: 'recepcionista',
    })

    const { POST } = await import('@/app/api/medicos/route')
    const res = await POST(
      new Request('http://localhost/api/medicos', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
        body: JSON.stringify({
          full_name: 'Dr. Teste',
          crm: 'CRM-RBAC-01',
          initial_percentage_bps: 4000,
          initial_valid_from: '2020-01-01',
          initial_reason: 'tentativa bloqueada',
        }),
      }),
    )
    expect(res.status).toBe(403)

    const sb = serviceClient()
    const { data: audit } = await sb
      .from('audit_log')
      .select('result, entity, actor_id')
      .eq('tenant_id', tenantId)
      .eq('actor_id', recep.userId)
      .eq('result', 'denied')
      .eq('entity', 'doctors')
    expect(audit?.length ?? 0).toBeGreaterThan(0)

    // And no doctor row was created.
    const { data: doctors } = await sb.from('doctors').select('id').eq('tenant_id', tenantId)
    expect(doctors ?? []).toHaveLength(0)
  })

  it('recepcionista gets 403 and audit denial when adding a commission version', async () => {
    const { tenantId } = await seedTenant('t121-comm')
    const { doctorId } = await seedDoctor(tenantId, { bps: 4000 })
    const recep = await seedUser(tenantId, 'recepcionista')
    const jwt = mintJwt({
      userId: recep.userId,
      email: recep.email,
      tenantId,
      role: 'recepcionista',
    })

    const { POST } = await import('@/app/api/medicos/[id]/commission/route')
    const res = await POST(
      new Request(`http://localhost/api/medicos/${doctorId}/commission`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
        body: JSON.stringify({
          percentage_bps: 5000,
          valid_from: '2027-01-01',
          reason: 'tentativa bloqueada',
        }),
      }),
      { params: { id: doctorId } },
    )
    expect(res.status).toBe(403)

    const sb = serviceClient()
    const { data: audit } = await sb
      .from('audit_log')
      .select('result, entity, actor_id')
      .eq('tenant_id', tenantId)
      .eq('actor_id', recep.userId)
      .eq('result', 'denied')
      .eq('entity', 'doctor_commission_history')
    expect(audit?.length ?? 0).toBeGreaterThan(0)

    // Only the seeded commission row exists.
    const { data: history } = await sb
      .from('doctor_commission_history')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('doctor_id', doctorId)
    expect(history ?? []).toHaveLength(1)
  })
})

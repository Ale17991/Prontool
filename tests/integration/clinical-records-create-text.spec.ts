/**
 * Admin cria registro clínico tipo `texto` e o lê de volta.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  resetDatabase,
  serviceClient,
} from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedPatient } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

describe('clinical_records — admin cria registro de texto', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('POST cria; GET lista o que foi criado', async () => {
    const { tenantId } = await seedTenant('cr-text')
    const patientId = await seedPatient(tenantId)
    const admin = await seedUser(tenantId, 'admin')
    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })

    const { POST } = await import('@/app/api/pacientes/[id]/registros/route')
    const createRes = await POST(
      new Request(`http://localhost/api/pacientes/${patientId}/registros`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ title: 'Anamnese inicial', content: 'Paciente refere dor lombar há 3 dias.' }),
      }),
      { params: { id: patientId } },
    )
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as { id: string; type: string; content: string }
    expect(created.type).toBe('texto')
    expect(created.content).toMatch(/dor lombar/)

    const { GET } = await import('@/app/api/pacientes/[id]/registros/route')
    const listRes = await GET(
      new Request(`http://localhost/api/pacientes/${patientId}/registros`, {
        headers: { authorization: `Bearer ${jwt}` },
      }),
      { params: { id: patientId } },
    )
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as Array<{ id: string }>
    expect(list).toHaveLength(1)
    expect(list[0]?.id).toBe(created.id)

    // Audit row was created via trigger
    const sb = serviceClient()
    const { data: audit } = await sb
      .from('audit_log')
      .select('entity, reason, result')
      .eq('tenant_id', tenantId)
      .eq('entity', 'clinical_records')
    expect(audit).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: 'record-created' })]),
    )
  })
})

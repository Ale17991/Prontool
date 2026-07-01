/**
 * Soft-delete: linha não some, vira invisível na listagem default.
 * Segundo DELETE devolve 409 (já removido).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedPatient } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

describe('clinical_records — soft-delete preserva linha', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('DELETE marca deleted_at, esconde da lista default, segundo DELETE → 409', async () => {
    const { tenantId } = await seedTenant('cr-del')
    const patientId = await seedPatient(tenantId)
    const admin = await seedUser(tenantId, 'admin')
    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })

    const { POST: createPost } = await import('@/app/api/pacientes/[id]/registros/route')
    const createRes = await createPost(
      new Request(`http://localhost/api/pacientes/${patientId}/registros`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ title: 'A apagar', content: 'Lorem ipsum' }),
      }),
      { params: { id: patientId } },
    )
    const created = (await createRes.json()) as { id: string }

    const { DELETE } = await import('@/app/api/pacientes/[id]/registros/[recordId]/route')

    const firstDel = await DELETE(
      new Request(`http://localhost/api/pacientes/${patientId}/registros/${created.id}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${jwt}` },
      }),
      { params: { id: patientId, recordId: created.id } },
    )
    expect(firstDel.status).toBe(200)

    // Linha continua na DB com deleted_at preenchido
    const sb = serviceClient()
    const { data: row } = await sb
      .from('clinical_records')
      .select('id, deleted_at')
      .eq('id', created.id)
      .single()
    expect(row?.deleted_at).toBeTruthy()

    // Listagem default não inclui apagados
    const { GET } = await import('@/app/api/pacientes/[id]/registros/route')
    const listRes = await GET(
      new Request(`http://localhost/api/pacientes/${patientId}/registros`, {
        headers: { authorization: `Bearer ${jwt}` },
      }),
      { params: { id: patientId } },
    )
    const list = (await listRes.json()) as unknown[]
    expect(list).toHaveLength(0)

    // Segundo DELETE → 409
    const secondDel = await DELETE(
      new Request(`http://localhost/api/pacientes/${patientId}/registros/${created.id}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${jwt}` },
      }),
      { params: { id: patientId, recordId: created.id } },
    )
    expect(secondDel.status).toBe(409)
  })
})

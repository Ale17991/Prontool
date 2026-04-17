/**
 * Lista de pacientes com busca por nome/CPF descriptografados.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  resetDatabase,
  serviceClient,
} from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { upsertPatientFromGhl } from '@/lib/core/patients/upsert-from-ghl'
import { mintJwt } from '@/tests/helpers/jwt-helper'

describe('GET /api/pacientes — lista + busca', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('encontra paciente por substring do nome e por substring do CPF', async () => {
    const { tenantId } = await seedTenant('pl-search')
    const sb = serviceClient()

    await upsertPatientFromGhl(sb, {
      tenantId,
      ghlContactId: 'ghl_a',
      fullName: 'Maria Aparecida Silva',
      cpf: '11122233344',
    })
    await upsertPatientFromGhl(sb, {
      tenantId,
      ghlContactId: 'ghl_b',
      fullName: 'João Pedro Souza',
      cpf: '99988877766',
    })

    const admin = await seedUser(tenantId, 'admin')
    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })

    const { GET } = await import('@/app/api/pacientes/route')

    // Sem busca — devolve ambos
    const all = await GET(
      new Request('http://localhost/api/pacientes', {
        headers: { authorization: `Bearer ${jwt}` },
      }),
    )
    expect(all.status).toBe(200)
    const allBody = (await all.json()) as { items: { fullName: string }[]; total: number }
    expect(allBody.total).toBe(2)

    // Busca por nome
    const byName = await GET(
      new Request('http://localhost/api/pacientes?q=Maria', {
        headers: { authorization: `Bearer ${jwt}` },
      }),
    )
    const byNameBody = (await byName.json()) as { items: { fullName: string }[]; total: number }
    expect(byNameBody.total).toBe(1)
    expect(byNameBody.items[0]?.fullName).toMatch(/Maria/)

    // Busca por CPF
    const byCpf = await GET(
      new Request('http://localhost/api/pacientes?q=99988', {
        headers: { authorization: `Bearer ${jwt}` },
      }),
    )
    const byCpfBody = (await byCpf.json()) as { items: { fullName: string }[]; total: number }
    expect(byCpfBody.total).toBe(1)
    expect(byCpfBody.items[0]?.fullName).toMatch(/João/)
  })
})

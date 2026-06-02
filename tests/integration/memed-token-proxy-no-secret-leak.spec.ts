/**
 * T026 (Feature 026/028) — o proxy de token NÃO vaza credenciais da Memed.
 *
 * GET /api/medicos/{id}/memed-token devolve apenas `{ token }`. As credenciais
 * (agora de plataforma, em env) jamais aparecem no corpo da resposta nem como
 * campo/valor reconhecível. Constituição IV / conformidade 027 (FR-010).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedDoctor } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'
import { mockMemed, seedMemedConnection, seedMemedPrescriber } from '@/tests/helpers/memed-mock'

describe('Feature 028 — token proxy sem vazamento de segredo', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('responde { token } sem expor api_key/secret_key', async () => {
    const { token } = mockMemed({ token: 'fresh.prescriber.jwt' })

    const sb = serviceClient()
    const { tenantId } = await seedTenant('memed-noleak')
    const admin = await seedUser(tenantId, 'admin')
    const { doctorId } = await seedDoctor(tenantId)
    await seedMemedConnection(tenantId, { createdBy: admin.userId }) // homologação
    await seedMemedPrescriber(tenantId, doctorId, { createdBy: admin.userId, status: 'registered' })

    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })
    const { GET } = await import('@/app/api/medicos/[id]/memed-token/route')
    const res = await GET(
      new Request(`http://localhost/api/medicos/${doctorId}/memed-token`, {
        headers: { authorization: `Bearer ${jwt}` },
      }),
      { params: { id: doctorId } },
    )

    expect(res.status).toBe(200)
    const raw = await res.text()
    // Devolve o token...
    expect(raw).toContain(token)
    // ...e NENHUM campo/valor de credencial (a chave de homologação real também
    // não pode aparecer — a query vai server-side, não na resposta ao browser).
    expect(raw).not.toMatch(/api[_-]?key|secret[_-]?key/i)
    expect(raw).not.toContain('iJGiB4kjDGOLeDFPWMG3no9VnN7Abpqe3w1jEFm6olkhkZD6oSfSmYCm')
    expect(raw).not.toContain('Xe8M5GvBGCr4FStKfxXKisRo3SfYKI7KrTMkJpCAstzu2yXVN4av5nmL')
    expect(Object.keys(JSON.parse(raw))).toEqual(['token'])
  })
})

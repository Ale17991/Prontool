/**
 * T026 (Feature 026) — o proxy de token NÃO vaza as chaves da Memed.
 *
 * GET /api/medicos/{id}/memed-token devolve apenas `{ token }`; as chaves
 * api_key/secret_key (cifradas em repouso) jamais aparecem no corpo da
 * resposta. Constituição IV / conformidade 027 (FR-010).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedDoctor } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'
import { mockMemed, seedMemedConnection, seedMemedPrescriber } from '@/tests/helpers/memed-mock'

describe('Feature 026 — token proxy sem vazamento de segredo', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('responde { token } sem expor api_key/secret_key', async () => {
    const API_KEY = 'SECRET_API_KEY_DO_NOT_LEAK_AAA'
    const SECRET_KEY = 'SECRET_SECRET_KEY_DO_NOT_LEAK_BBB'
    const { token } = mockMemed({ token: 'fresh.prescriber.jwt' })

    const sb = serviceClient()
    const { tenantId } = await seedTenant('memed-noleak')
    const admin = await seedUser(tenantId, 'admin')
    const { doctorId } = await seedDoctor(tenantId)
    await seedMemedConnection(tenantId, { createdBy: admin.userId, apiKey: API_KEY, secretKey: SECRET_KEY })
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
    expect(raw).toContain(token)
    expect(raw).not.toContain(API_KEY)
    expect(raw).not.toContain(SECRET_KEY)
  })
})

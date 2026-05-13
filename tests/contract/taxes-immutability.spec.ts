/**
 * T015 (Feature 011) — Constitution Principle I: imutabilidade da tabela taxes.
 *
 * Triggers da migration 0076:
 *  - enforce_taxes_mutation: bloqueia UPDATE de name/category/created_at/created_by/tenant_id/id.
 *  - taxes_no_physical_delete: bloqueia DELETE.
 * rate_bps, description, is_active, deleted_at PERMANECEM mutáveis (com audit).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import {
  resetDatabase,
  rlsClient,
  serviceClient,
} from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

describe('Feature 011 — taxes immutability', () => {
  let tenantId: string
  let adminJwt: string
  let adminUserId: string
  let taxId: string

  beforeAll(async () => {
    await resetDatabase()
    const t = await seedTenant('taxes-imm')
    tenantId = t.tenantId
    const admin = await seedUser(tenantId, 'admin')
    adminUserId = admin.userId
    adminJwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })
  })

  beforeEach(async () => {
    const sb = serviceClient()
    const { data, error } = await sb
      .from('taxes' as never)
      .insert({
        tenant_id: tenantId,
        name: `ISS-${Math.random().toString(36).slice(2, 8)}`,
        rate_bps: 500,
        category: 'municipal',
        created_by: adminUserId,
      } as never)
      .select('id')
      .single()
    if (error) throw new Error(`seed tax failed: ${error.message}`)
    taxId = (data as unknown as { id: string }).id
  })

  it('UPDATE name (mesmo via authenticated/admin) é rejeitado pelo trigger', async () => {
    const sb = rlsClient(adminJwt)
    const { error } = await sb
      .from('taxes' as never)
      .update({ name: 'OUTRO_NOME' } as never)
      .eq('id', taxId)
    // Trigger BEFORE UPDATE bloqueia. PostgREST devolve permission/policy/violates;
    // o trigger RAISE EXCEPTION com mensagem em pt-EN.
    expect(error).not.toBeNull()
  })

  it('UPDATE category é rejeitado pelo trigger', async () => {
    const sb = rlsClient(adminJwt)
    const { error } = await sb
      .from('taxes' as never)
      .update({ category: 'federal' } as never)
      .eq('id', taxId)
    expect(error).not.toBeNull()
  })

  it('UPDATE rate_bps é PERMITIDO (mutável) — via API route que é o caminho real do usuário', async () => {
    const { PATCH } = await import('@/app/api/impostos/[id]/route')
    const res = await PATCH(
      new Request(`http://localhost/api/impostos/${taxId}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${adminJwt}`,
        },
        body: JSON.stringify({ rate_bps: 750 }),
      }),
      { params: { id: taxId } },
    )
    expect(res.status).toBe(200)
    // Confirma persistência via service role
    const sb = serviceClient()
    const { data } = await sb
      .from('taxes' as never)
      .select('rate_bps')
      .eq('id', taxId)
      .single()
    expect((data as unknown as { rate_bps: number }).rate_bps).toBe(750)
  })

  it('UPDATE is_active é PERMITIDO (soft deactivate) — via API route', async () => {
    const { PATCH } = await import('@/app/api/impostos/[id]/route')
    const res = await PATCH(
      new Request(`http://localhost/api/impostos/${taxId}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${adminJwt}`,
        },
        body: JSON.stringify({ is_active: false }),
      }),
      { params: { id: taxId } },
    )
    expect(res.status).toBe(200)
    const sb = serviceClient()
    const { data } = await sb
      .from('taxes' as never)
      .select('is_active')
      .eq('id', taxId)
      .single()
    expect((data as unknown as { is_active: boolean }).is_active).toBe(false)
  })

  it('DELETE físico é rejeitado por enforce_append_only', async () => {
    const sb = rlsClient(adminJwt)
    const { error } = await sb.from('taxes' as never).delete().eq('id', taxId)
    // DELETE foi REVOKED para authenticated; pode falhar como permission denied
    // antes mesmo do trigger. Ambos cenários são aceitáveis — o importante é
    // que nada seja efetivamente deletado.
    expect(error).not.toBeNull()
    const sbSvc = serviceClient()
    const { data } = await sbSvc
      .from('taxes' as never)
      .select('id')
      .eq('id', taxId)
      .maybeSingle()
    expect(data).not.toBeNull()
  })
})

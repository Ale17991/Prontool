/**
 * T015 (Feature 029 / US1) — configurar TISS por operadora.
 *  - POST com dados válidos habilita a operadora e persiste + audita.
 *  - POST sem Registro ANS → 422 com o campo faltante.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedHealthPlan } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

async function setup(slug: string) {
  const { tenantId } = await seedTenant(slug)
  const admin = await seedUser(tenantId, 'admin')
  const planId = await seedHealthPlan(tenantId, 'Operadora X')
  const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })
  return { tenantId, planId, jwt }
}

function post(planId: string, jwt: string, body: unknown) {
  return new Request(`http://localhost/api/tiss/operadoras/${planId}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('Feature 029 — config TISS por operadora (US1)', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('habilita a operadora com dados válidos e audita', async () => {
    const { tenantId, planId, jwt } = await setup('tiss-cfg-ok')
    const { POST } = await import('@/app/api/tiss/operadoras/[planId]/route')
    const res = await POST(
      post(planId, jwt, {
        ans_registration: '123456',
        contracted_code: 'CTR-1',
        contracted_cnpj: '00.000.000/0001-91',
        contracted_cnes: '9999999',
      }),
      { params: { planId } },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string; status: string }
    expect(body.status).toBe('habilitado')

    const sb = serviceClient()
    const { data } = await sb
      .from('tenant_tiss_operator_config')
      .select('ans_registration, contracted_cnpj, active')
      .eq('tenant_id', tenantId)
      .eq('health_plan_id', planId)
      .single()
    expect(data?.ans_registration).toBe('123456')
    expect(data?.contracted_cnpj).toBe('00000000000191') // máscara removida
    expect(data?.active).toBe(true)

    const { data: audit } = await sb
      .from('audit_log')
      .select('field')
      .eq('tenant_id', tenantId)
      .eq('field', 'tiss.operator.configure')
      .maybeSingle()
    expect(audit?.field).toBe('tiss.operator.configure')
  })

  it('rejeita com 422 quando falta o Registro ANS', async () => {
    const { planId, jwt } = await setup('tiss-cfg-missing')
    const { POST } = await import('@/app/api/tiss/operadoras/[planId]/route')
    const res = await POST(
      post(planId, jwt, { contracted_code: 'CTR-1', contracted_cnpj: '00000000000191' }),
      { params: { planId } },
    )
    expect(res.status).toBe(422)
    const body = (await res.json()) as { error: { fields: { field: string }[] } }
    expect(body.error.fields.some((f) => f.field === 'ans_registration')).toBe(true)
  })
})

/**
 * T007 — o guard de todo impresso.
 *
 * Estas rotas devolvem dado clínico identificado de paciente. As quatro regras
 * de acesso vivem num helper único justamente para não haver uma sétima rota
 * que esqueceu uma delas; este teste cobre o helper pela rota real.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedPatient } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'
import type { TenantRole } from '@/lib/db/types'

const roles: TenantRole[] = ['admin', 'financeiro', 'recepcionista', 'profissional_saude']

async function getPdf(patientId: string, jwt: string): Promise<Response> {
  const { GET } = await import('@/app/api/pacientes/[id]/plano-alimentar/pdf/route')
  return GET(
    new Request(`http://localhost/api/pacientes/${patientId}/plano-alimentar/pdf`, {
      headers: { authorization: `Bearer ${jwt}` },
    }),
    { params: { id: patientId } },
  )
}

describe('RBAC do impresso', () => {
  let tenantId: string
  let patientId: string
  const users: Record<TenantRole, string> = {} as never

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('printout-rbac')).tenantId
    for (const role of roles) {
      const u = await seedUser(tenantId, role)
      users[role] = mintJwt({ userId: u.userId, email: u.email, tenantId, role })
    }
    patientId = await seedPatient(tenantId)
  })

  for (const role of roles) {
    const permitido = role === 'admin' || role === 'profissional_saude'
    it(`${role} → ${permitido ? 'passa pelo RBAC' : '403'}`, async () => {
      const res = await getPdf(patientId, users[role])
      if (permitido) {
        // Sem plano cadastrado o resultado é 404 NO_PLAN — o que importa aqui é
        // que NÃO foi barrado por papel.
        expect(res.status).not.toBe(403)
      } else {
        expect(res.status).toBe(403)
      }
    })
  }
})

describe('gate de módulo', () => {
  it('sem o módulo dieta, admin recebe 404 MODULE_DISABLED', async () => {
    await resetDatabase()
    const tenantId = (await seedTenant('printout-nomod')).tenantId
    const admin = await seedUser(tenantId, 'admin')
    const patientId = await seedPatient(tenantId)
    const { error } = await serviceClient()
      .from('tenant_entitlements')
      .insert({ tenant_id: tenantId, plan: 'pro', status: 'active', modules: ['odonto'] } as never)
    if (error) throw new Error(`seed entitlements: ${error.message}`)

    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })
    const res = await getPdf(patientId, jwt)
    expect(res.status).toBe(404)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('MODULE_DISABLED')
  })
})

describe('isolamento entre clínicas', () => {
  it('paciente de outra clínica devolve 404, nunca 403', async () => {
    await resetDatabase()
    const a = (await seedTenant('printout-iso-a')).tenantId
    const b = (await seedTenant('printout-iso-b')).tenantId
    const pacienteDeA = await seedPatient(a)
    const adminB = await seedUser(b, 'admin')
    const jwtB = mintJwt({ userId: adminB.userId, email: adminB.email, tenantId: b, role: 'admin' })

    const res = await getPdf(pacienteDeA, jwtB)
    // 403 confirmaria que o paciente existe em algum lugar do sistema — é o
    // que o isolamento precisa esconder.
    expect(res.status).toBe(404)
    expect(res.status).not.toBe(403)
  })
})

describe('paciente anonimizado', () => {
  it('não emite documento identificado (409)', async () => {
    await resetDatabase()
    const tenantId = (await seedTenant('printout-anon')).tenantId
    const admin = await seedUser(tenantId, 'admin')
    const patientId = await seedPatient(tenantId)
    const upd = await serviceClient()
      .from('patients')
      .update({ anonymized_at: new Date().toISOString() } as never)
      .eq('tenant_id', tenantId)
      .eq('id', patientId)
    if (upd.error) throw new Error(`anonimizar: ${upd.error.message}`)

    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })
    const res = await getPdf(patientId, jwt)
    // Emitir aqui desfaria na impressora o apagamento que a LGPD exigiu.
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('PATIENT_ANONYMIZED')
  })
})

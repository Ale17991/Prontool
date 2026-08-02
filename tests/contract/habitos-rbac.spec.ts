/**
 * Checklist de hábitos — contrato das rotas.
 *
 * A rota do PORTAL é a mais sensível do sistema hoje: é a única que aceita
 * escrita sem usuário autenticado no Supabase. O teste central é que sem sessão
 * não se escreve nada, e que o corpo do pedido não carrega identidade nenhuma
 * que pudesse ser forjada.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedPatient } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'
import type { TenantRole } from '@/lib/db/types'

const roles: TenantRole[] = ['admin', 'financeiro', 'recepcionista', 'profissional_saude']

function body(): Record<string, unknown> {
  return {
    title: 'Meus hábitos',
    periodKind: 'semanal',
    startDate: '2026-08-03',
    items: [{ id: 'agua', label: 'Bateu a meta de água?' }],
  }
}

async function putChecklist(patientId: string, jwt: string, payload = body()): Promise<Response> {
  const { PUT } = await import('@/app/api/pacientes/[id]/habitos/route')
  return PUT(
    new Request(`http://localhost/api/pacientes/${patientId}/habitos`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
      body: JSON.stringify(payload),
    }),
    { params: { id: patientId } },
  )
}

describe('RBAC do checklist de hábitos (equipe)', () => {
  let tenantId: string
  let patientId: string
  const users: Record<TenantRole, string> = {} as never

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('habitos-rbac')).tenantId
    for (const role of roles) {
      const u = await seedUser(tenantId, role)
      users[role] = mintJwt({ userId: u.userId, email: u.email, tenantId, role })
    }
    patientId = await seedPatient(tenantId)
  })

  for (const role of roles) {
    const allowed = role === 'admin' || role === 'profissional_saude'
    it(`PUT → ${allowed ? 200 : 403} para ${role}`, async () => {
      const res = await putChecklist(patientId, users[role])
      expect(res.status).toBe(allowed ? 200 : 403)
    })
  }

  it('id de hábito repetido → 422 (colidiria com o UNIQUE das marcações)', async () => {
    const res = await putChecklist(patientId, users.admin, {
      ...body(),
      items: [
        { id: 'agua', label: 'Bebeu água?' },
        { id: 'agua', label: 'Outra coisa?' },
      ],
    })
    expect(res.status).toBe(422)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('DUPLICATE_ITEM_ID')
  })

  it('sem hábito nenhum → 400', async () => {
    const res = await putChecklist(patientId, users.admin, { ...body(), items: [] })
    expect(res.status).toBe(400)
  })
})

describe('gate do módulo habitos', () => {
  it('sem o módulo, PUT → 404 mesmo para admin', async () => {
    await resetDatabase()
    const tenantId = (await seedTenant('habitos-nomod')).tenantId
    const admin = await seedUser(tenantId, 'admin')
    const patientId = await seedPatient(tenantId)
    const { error } = await serviceClient()
      .from('tenant_entitlements')
      .insert({ tenant_id: tenantId, plan: 'pro', status: 'active', modules: ['dieta'] } as never)
    if (error) throw new Error(`seed entitlements: ${error.message}`)
    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })
    expect((await putChecklist(patientId, jwt)).status).toBe(404)
  })
})

describe('escrita do paciente no portal', () => {
  it('sem cookie de sessão, POST → 401 e nada é gravado', async () => {
    await resetDatabase()
    const tenantId = (await seedTenant('habitos-portal')).tenantId
    const patientId = await seedPatient(tenantId)

    const { POST } = await import('@/app/api/paciente/habitos/route')
    const res = await POST(
      new Request('http://localhost/api/paciente/habitos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // Repare: não há como informar QUEM é — o corpo só diz o quê e quando.
        body: JSON.stringify({ itemId: 'agua', markDate: '2026-08-06', marked: true }),
      }) as never,
    )
    expect(res.status).toBe(401)

    const marks = await serviceClient()
      .from('habit_checklist_marks')
      .select('id')
      .eq('tenant_id', tenantId)
    expect((marks.data ?? []).length).toBe(0)
    expect(patientId).toBeTruthy()
  })

  it('GET sem sessão também é 401', async () => {
    const { GET } = await import('@/app/api/paciente/habitos/route')
    const res = await GET(new Request('http://localhost/api/paciente/habitos') as never)
    expect(res.status).toBe(401)
  })
})

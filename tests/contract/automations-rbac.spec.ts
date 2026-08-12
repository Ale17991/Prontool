/**
 * T033 (Feature 056) — matriz de papéis contra as rotas de automação.
 *
 * Todas são admin-only (FR-022). Montar automação não é ato operacional: decide
 * quem recebe mensagem e qual, e uma recepcionista ligando um gatilho de
 * "paciente sem retorno" numa base grande dispara para metade dela.
 *
 * Constituição, Princípio V: papel é validado no servidor, sempre.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'
import type { TenantRole } from '@/lib/db/types'

const sb = serviceClient()
const ROLES: TenantRole[] = ['admin', 'financeiro', 'recepcionista', 'profissional_saude']

describe('Feature 056 — RBAC das rotas de automação', () => {
  let tenantId: string
  let mensagemId: string
  let gatilhoId: string
  const users: Record<TenantRole, string> = {} as never

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('auto-rbac')).tenantId

    const { error } = await sb.from('tenant_entitlements' as never).insert({
      tenant_id: tenantId,
      plan: 'pro',
      status: 'active',
      modules: ['automacoes'],
    } as never)
    if (error) throw new Error(`entitlements: ${error.message}`)

    for (const role of ROLES) {
      const u = await seedUser(tenantId, role)
      users[role] = mintJwt({ userId: u.userId, email: u.email, tenantId, role })
    }

    const { data: m } = await sb
      .from('message_templates' as never)
      .insert({ tenant_id: tenantId, name: 'Seed', body: 'Oi {{paciente}}' } as never)
      .select('id')
      .single()
    mensagemId = (m as unknown as { id: string }).id

    const { data: g } = await sb
      .from('automation_triggers' as never)
      .insert({ tenant_id: tenantId, name: 'Seed', source: 'aniversario', params: {} } as never)
      .select('id')
      .single()
    gatilhoId = (g as unknown as { id: string }).id
  })

  for (const role of ROLES) {
    const esperado = role === 'admin' ? 200 : 403

    it(`GET /api/automacoes/mensagens → ${esperado} para ${role}`, async () => {
      const { GET } = await import('@/app/api/automacoes/mensagens/route')
      const res = await GET(
        new Request('http://localhost/api/automacoes/mensagens', {
          headers: { authorization: `Bearer ${users[role]}` },
        }),
      )
      expect(res.status).toBe(esperado)
    })

    it(`GET /api/automacoes/gatilhos → ${esperado} para ${role}`, async () => {
      const { GET } = await import('@/app/api/automacoes/gatilhos/route')
      const res = await GET(
        new Request('http://localhost/api/automacoes/gatilhos', {
          headers: { authorization: `Bearer ${users[role]}` },
        }),
      )
      expect(res.status).toBe(esperado)
    })

    it(`GET /api/automacoes → ${esperado} para ${role}`, async () => {
      const { GET } = await import('@/app/api/automacoes/route')
      const res = await GET(
        new Request('http://localhost/api/automacoes', {
          headers: { authorization: `Bearer ${users[role]}` },
        }),
      )
      expect(res.status).toBe(esperado)
    })
  }

  for (const role of ROLES) {
    const esperado = role === 'admin' ? 201 : 403
    it(`POST /api/automacoes/mensagens → ${esperado} para ${role}`, async () => {
      const { POST } = await import('@/app/api/automacoes/mensagens/route')
      const res = await POST(
        new Request('http://localhost/api/automacoes/mensagens', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${users[role]}` },
          body: JSON.stringify({ name: `Msg ${role}`, body: 'Oi {{paciente}}' }),
        }),
      )
      expect(res.status).toBe(esperado)
    })
  }

  for (const role of ROLES) {
    const esperado = role === 'admin' ? 201 : 403
    it(`POST /api/automacoes (associar) → ${esperado} para ${role}`, async () => {
      // Só a de admin chega a criar de fato; as outras param no papel. Para o
      // admin não colidir com o UNIQUE, cada rodada usa um gatilho novo.
      let trg = gatilhoId
      if (role === 'admin') {
        const { data } = await sb
          .from('automation_triggers' as never)
          .insert({
            tenant_id: tenantId,
            name: `Gatilho ${role}`,
            source: 'aniversario',
            params: {},
          } as never)
          .select('id')
          .single()
        trg = (data as unknown as { id: string }).id
      }

      const { POST } = await import('@/app/api/automacoes/route')
      const res = await POST(
        new Request('http://localhost/api/automacoes', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${users[role]}` },
          body: JSON.stringify({ triggerId: trg, messageTemplateId: mensagemId }),
        }),
      )
      expect(res.status).toBe(esperado)
    })
  }

  it('a associação recusa mensagem que pede variável que a fonte não fornece', async () => {
    const { data: msg } = await sb
      .from('message_templates' as never)
      .insert({
        tenant_id: tenantId,
        name: 'Pede procedimento',
        // `procedimento` não é universal e aniversário não fornece.
        body: 'Oi {{paciente}}, seu {{procedimento}} está marcado',
      } as never)
      .select('id')
      .single()

    const { data: trg } = await sb
      .from('automation_triggers' as never)
      .insert({
        tenant_id: tenantId,
        name: 'Gatilho variavel',
        source: 'aniversario',
        params: {},
      } as never)
      .select('id')
      .single()

    const { POST } = await import('@/app/api/automacoes/route')
    const res = await POST(
      new Request('http://localhost/api/automacoes', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${users.admin}` },
        body: JSON.stringify({
          triggerId: (trg as unknown as { id: string }).id,
          messageTemplateId: (msg as unknown as { id: string }).id,
        }),
      }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string; detail?: string }
    expect(body.error).toBe('VARIAVEL_NAO_FORNECIDA')
    // A mensagem de erro precisa dizer QUAL variável e QUAL gatilho — senão a
    // clínica fica adivinhando.
    expect(body.detail).toMatch(/procedimento/)
  })

  it('gatilho com fonte inexistente é recusado', async () => {
    const { POST } = await import('@/app/api/automacoes/gatilhos/route')
    const res = await POST(
      new Request('http://localhost/api/automacoes/gatilhos', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${users.admin}` },
        body: JSON.stringify({ name: 'Inventado', source: 'nao_existe', params: {} }),
      }),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('FONTE_DESCONHECIDA')
  })

  it('mensagem com variável desconhecida é recusada na criação', async () => {
    const { POST } = await import('@/app/api/automacoes/mensagens/route')
    const res = await POST(
      new Request('http://localhost/api/automacoes/mensagens', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${users.admin}` },
        body: JSON.stringify({ name: 'Ruim', body: 'Oi {{inexistente}}' }),
      }),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('VARIAVEL_DESCONHECIDA')
  })
})

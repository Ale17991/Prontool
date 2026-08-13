/**
 * T034 (Feature 056) — isolamento entre clínicas.
 *
 * Constituição, Princípio III: defesa em camadas. O caso que merece atenção
 * aqui não é o óbvio (ler dado de outro tenant), é o CRUZADO: montar uma
 * automação juntando um gatilho de uma clínica com uma mensagem de outra. As
 * FKs sozinhas permitiriam — cada uma aponta para uma tabela válida — e é por
 * isso que a 0196 tem um trigger, e não só chaves estrangeiras.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

const sb = serviceClient()

async function seedComModulo(slug: string) {
  const { tenantId } = await seedTenant(slug)
  const { error } = await sb.from('tenant_entitlements' as never).insert({
    tenant_id: tenantId,
    plan: 'pro',
    status: 'active',
    modules: ['automacoes'],
  } as never)
  if (error) throw new Error(`entitlements: ${error.message}`)
  const admin = await seedUser(tenantId, 'admin')
  return {
    tenantId,
    jwt: mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' }),
  }
}

async function seedMensagem(tenantId: string, name: string): Promise<string> {
  const { data, error } = await sb
    .from('message_templates' as never)
    .insert({ tenant_id: tenantId, name, body: 'Oi {{paciente}}' } as never)
    .select('id')
    .single()
  if (error) throw new Error(`msg: ${error.message}`)
  return (data as unknown as { id: string }).id
}

async function seedGatilho(tenantId: string, name: string): Promise<string> {
  const { data, error } = await sb
    .from('automation_triggers' as never)
    .insert({ tenant_id: tenantId, name, source: 'aniversario', params: {} } as never)
    .select('id')
    .single()
  if (error) throw new Error(`trigger: ${error.message}`)
  return (data as unknown as { id: string }).id
}

describe('Feature 056 — isolamento entre tenants', () => {
  let A: { tenantId: string; jwt: string }
  let B: { tenantId: string; jwt: string }
  let msgA: string
  let gatA: string
  let msgB: string

  beforeAll(async () => {
    await resetDatabase()
    A = await seedComModulo('auto-iso-a')
    B = await seedComModulo('auto-iso-b')
    msgA = await seedMensagem(A.tenantId, 'Mensagem A')
    gatA = await seedGatilho(A.tenantId, 'Gatilho A')
    msgB = await seedMensagem(B.tenantId, 'Mensagem B')
  })

  it('a clínica B não vê as mensagens da clínica A', async () => {
    const { GET } = await import('@/app/api/automacoes/mensagens/route')
    const res = await GET(
      new Request('http://localhost/api/automacoes/mensagens', {
        headers: { authorization: `Bearer ${B.jwt}` },
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { mensagens: Array<{ id: string; name: string }> }
    expect(body.mensagens.map((m) => m.name)).toEqual(['Mensagem B'])
    expect(body.mensagens.some((m) => m.id === msgA)).toBe(false)
  })

  it('a clínica B não vê os gatilhos da clínica A', async () => {
    const { GET } = await import('@/app/api/automacoes/gatilhos/route')
    const res = await GET(
      new Request('http://localhost/api/automacoes/gatilhos', {
        headers: { authorization: `Bearer ${B.jwt}` },
      }),
    )
    const body = (await res.json()) as { gatilhos: Array<{ id: string }> }
    expect(body.gatilhos.some((g) => g.id === gatA)).toBe(false)
  })

  it('a clínica B não consegue editar mensagem da clínica A', async () => {
    const { PATCH } = await import('@/app/api/automacoes/mensagens/[id]/route')
    await PATCH(
      new Request(`http://localhost/api/automacoes/mensagens/${msgA}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${B.jwt}` },
        body: JSON.stringify({ name: 'Sequestrada' }),
      }),
      { params: { id: msgA } },
    )
    // O UPDATE filtra por tenant, então não encontra linha — o dado de A fica
    // intacto, que é o que importa.
    const { data } = await sb
      .from('message_templates' as never)
      .select('name')
      .eq('id', msgA)
      .single()
    expect((data as unknown as { name: string }).name).toBe('Mensagem A')
  })

  it('a prévia de um gatilho de outra clínica responde 404', async () => {
    const { GET } = await import('@/app/api/automacoes/gatilhos/[id]/previa/route')
    const res = await GET(
      new Request(`http://localhost/api/automacoes/gatilhos/${gatA}/previa`, {
        headers: { authorization: `Bearer ${B.jwt}` },
      }),
      { params: { id: gatA } },
    )
    expect(res.status).toBe(404)
  })

  it('CRUZADO: não dá para juntar gatilho de A com mensagem de B, nem no banco', async () => {
    // Direto no banco, com service client — sem passar pela rota. As FKs
    // aceitariam: ambos os ids existem. Quem recusa é o trigger da 0196.
    const { error } = await sb.from('automations' as never).insert({
      tenant_id: A.tenantId,
      name: `Auto ${gatA.slice(0, 8)}`,
      trigger_id: gatA,
      message_template_id: msgB,
    } as never)
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/own tenant/i)
  })

  it('sem o módulo, admin da própria clínica leva 404', async () => {
    const semModulo = await seedTenant('auto-iso-sem-modulo')
    await sb.from('tenant_entitlements' as never).insert({
      tenant_id: semModulo.tenantId,
      plan: 'pro',
      status: 'active',
      modules: ['dieta'],
    } as never)
    const u = await seedUser(semModulo.tenantId, 'admin')
    const jwt = mintJwt({
      userId: u.userId,
      email: u.email,
      tenantId: semModulo.tenantId,
      role: 'admin',
    })

    const { GET } = await import('@/app/api/automacoes/mensagens/route')
    const res = await GET(
      new Request('http://localhost/api/automacoes/mensagens', {
        headers: { authorization: `Bearer ${jwt}` },
      }),
    )
    expect(res.status).toBe(404)
  })
})

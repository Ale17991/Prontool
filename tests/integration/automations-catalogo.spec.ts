/**
 * T042 (Feature 056) — o catálogo é catálogo, não cópia.
 *
 * Duas promessas do FR-003/FR-004 que só aparecem com banco de verdade:
 *  - editar a mensagem UMA vez muda o que sai por TODOS os gatilhos que a usam;
 *  - excluir mensagem em uso é recusado, e a recusa NOMEIA quem depende dela.
 *
 * A segunda é fácil de implementar pela metade. "Não é possível excluir" sem
 * dizer o quê obriga a clínica a caçar — e ela caça errado.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'
import { listActiveAutomations } from '@/lib/core/automations/store'

const sb = serviceClient()

async function clinica(slug: string) {
  const { tenantId } = await seedTenant(slug)
  await sb.from('tenant_entitlements' as never).insert({
    tenant_id: tenantId,
    plan: 'pro',
    status: 'active',
    modules: ['automacoes'],
  } as never)
  const admin = await seedUser(tenantId, 'admin')
  return {
    tenantId,
    jwt: mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' }),
  }
}

async function novaMensagem(tenantId: string, name: string, body: string): Promise<string> {
  const { data, error } = await sb
    .from('message_templates' as never)
    .insert({ tenant_id: tenantId, name, body } as never)
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return (data as unknown as { id: string }).id
}

async function novoGatilho(tenantId: string, name: string): Promise<string> {
  const { data, error } = await sb
    .from('automation_triggers' as never)
    .insert({ tenant_id: tenantId, name, source: 'aniversario', params: {} } as never)
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return (data as unknown as { id: string }).id
}

async function novaAutomacao(tenantId: string, triggerId: string, messageId: string) {
  const { error } = await sb.from('automations' as never).insert({
    tenant_id: tenantId,
    trigger_id: triggerId,
    message_template_id: messageId,
    active: true,
  } as never)
  if (error) throw new Error(error.message)
}

describe('Feature 056 — catálogo de mensagens reutilizáveis', () => {
  let ctx: { tenantId: string; jwt: string }

  beforeEach(async () => {
    await resetDatabase()
    ctx = await clinica(`cat-${randomUUID().slice(0, 6)}`)
  })

  it('a MESMA mensagem serve dois gatilhos, e editar propaga para os dois', async () => {
    const msg = await novaMensagem(ctx.tenantId, 'Compartilhada', 'Texto original {{paciente}}')
    const g1 = await novoGatilho(ctx.tenantId, 'Gatilho 1')
    const g2 = await novoGatilho(ctx.tenantId, 'Gatilho 2')
    await novaAutomacao(ctx.tenantId, g1, msg)
    await novaAutomacao(ctx.tenantId, g2, msg)

    const { PATCH } = await import('@/app/api/automacoes/mensagens/[id]/route')
    const res = await PATCH(
      new Request(`http://localhost/api/automacoes/mensagens/${msg}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${ctx.jwt}` },
        body: JSON.stringify({ body: 'Texto NOVO {{paciente}}' }),
      }),
      { params: { id: msg } },
    )
    expect(res.status).toBe(200)

    // O que o motor vê é o que importa: as duas automações passam a carregar o
    // texto novo, sem ninguém tocar nos gatilhos.
    const ativas = await listActiveAutomations(sb, ctx.tenantId)
    expect(ativas).toHaveLength(2)
    for (const a of ativas) expect(a.body).toBe('Texto NOVO {{paciente}}')
  })

  it('trocar a mensagem de um gatilho não recria o gatilho', async () => {
    const msgA = await novaMensagem(ctx.tenantId, 'A', 'Texto A')
    const msgB = await novaMensagem(ctx.tenantId, 'B', 'Texto B')
    const g = await novoGatilho(ctx.tenantId, 'Único')
    await novaAutomacao(ctx.tenantId, g, msgA)

    // Trocar = criar a associação com a outra mensagem e desligar a anterior.
    // O gatilho `g` continua o mesmo registro.
    await novaAutomacao(ctx.tenantId, g, msgB)
    await sb
      .from('automations' as never)
      .update({ active: false } as never)
      .eq('message_template_id', msgA)

    const ativas = await listActiveAutomations(sb, ctx.tenantId)
    expect(ativas).toHaveLength(1)
    expect(ativas[0]?.body).toBe('Texto B')
    expect(ativas[0]?.triggerId).toBe(g)
  })

  it('excluir mensagem EM USO é recusado, nomeando os gatilhos', async () => {
    const msg = await novaMensagem(ctx.tenantId, 'Em uso', 'Texto')
    const g1 = await novoGatilho(ctx.tenantId, 'Aniversário VIP')
    const g2 = await novoGatilho(ctx.tenantId, 'Retorno anual')
    await novaAutomacao(ctx.tenantId, g1, msg)
    await novaAutomacao(ctx.tenantId, g2, msg)

    const { DELETE } = await import('@/app/api/automacoes/mensagens/[id]/route')
    const res = await DELETE(
      new Request(`http://localhost/api/automacoes/mensagens/${msg}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${ctx.jwt}` },
      }),
      { params: { id: msg } },
    )

    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string; detail: string }
    expect(body.error).toBe('MENSAGEM_EM_USO')
    // Os DOIS nomes: dizer só um mandaria a clínica excluir a automação errada.
    expect(body.detail).toContain('Aniversário VIP')
    expect(body.detail).toContain('Retorno anual')
  })

  it('mensagem sem uso é excluída normalmente', async () => {
    const msg = await novaMensagem(ctx.tenantId, 'Solta', 'Texto')
    const { DELETE } = await import('@/app/api/automacoes/mensagens/[id]/route')
    const res = await DELETE(
      new Request(`http://localhost/api/automacoes/mensagens/${msg}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${ctx.jwt}` },
      }),
      { params: { id: msg } },
    )
    expect(res.status).toBe(204)
  })

  it('a listagem informa quantas automações dependem de cada mensagem', async () => {
    const usada = await novaMensagem(ctx.tenantId, 'Usada', 'Texto')
    await novaMensagem(ctx.tenantId, 'Livre', 'Texto')
    const g = await novoGatilho(ctx.tenantId, 'G')
    await novaAutomacao(ctx.tenantId, g, usada)

    const { GET } = await import('@/app/api/automacoes/mensagens/route')
    const res = await GET(
      new Request('http://localhost/api/automacoes/mensagens', {
        headers: { authorization: `Bearer ${ctx.jwt}` },
      }),
    )
    const body = (await res.json()) as { mensagens: Array<{ name: string; usadaPor: number }> }
    expect(body.mensagens.find((m) => m.name === 'Usada')?.usadaPor).toBe(1)
    expect(body.mensagens.find((m) => m.name === 'Livre')?.usadaPor).toBe(0)
  })

  it('desativar a MENSAGEM cala a automação, sem precisar desativá-la também', async () => {
    const msg = await novaMensagem(ctx.tenantId, 'Vai desligar', 'Texto')
    const g = await novoGatilho(ctx.tenantId, 'G')
    await novaAutomacao(ctx.tenantId, g, msg)

    await sb
      .from('message_templates' as never)
      .update({ active: false } as never)
      .eq('id', msg)

    // Senão a clínica desliga a mensagem e continua enviando com ela.
    expect(await listActiveAutomations(sb, ctx.tenantId)).toHaveLength(0)
  })
})

/**
 * Feature 056 — os três caminhos que sobraram sem cobertura automatizada.
 *
 * Todos passaram por verificação manual em 14/08/2026 e nenhum tinha teste. No
 * mesmo dia, três defeitos atravessaram exatamente esse tipo de verificação sem
 * serem vistos — o telefone sem código de país, a exclusão impossível e o ACK
 * que nunca chegava. Verificar à mão prova que funcionou uma vez; o teste é o
 * que impede de parar de funcionar depois.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'
import { previewSource } from '@/lib/core/automations/preview'

const sb = serviceClient()

async function seedClinica(slug: string) {
  const { tenantId } = await seedTenant(slug)
  await sb
    .from('tenant_entitlements' as never)
    .insert({
      tenant_id: tenantId,
      plan: 'pro',
      status: 'active',
      modules: ['automacoes'],
    } as never)
    .throwOnError()
  await sb
    .from('tenant_clinic_profile' as never)
    .insert({ tenant_id: tenantId, corporate_name: 'Clínica Teste' } as never)
    .throwOnError()
  const u = await seedUser(tenantId, 'admin')
  return { tenantId, jwt: mintJwt({ userId: u.userId, email: u.email, tenantId, role: 'admin' }) }
}

function req(url: string, jwt: string, body: unknown, method = 'PATCH') {
  return new Request(url, {
    method,
    headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function perfil(tenantId: string) {
  const { data } = await sb
    .from('tenant_clinic_profile' as never)
    .select('automation_window_start, automation_window_end, automation_weekdays')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  return data as unknown as {
    automation_window_start: string
    automation_window_end: string
    automation_weekdays: number[]
  }
}

// ===========================================================================
// 1. A rota que grava a janela de envio (0201)
// ===========================================================================

describe('Feature 056 — configuração da janela de envio', () => {
  let tenantId: string
  let jwt: string

  beforeAll(async () => {
    await resetDatabase()
    const c = await seedClinica('auto-cfg')
    tenantId = c.tenantId
    jwt = c.jwt
  })

  it('grava horário e dias', async () => {
    const { PATCH } = await import('@/app/api/automacoes/configuracao/route')
    const res = await PATCH(
      req('http://localhost/api/automacoes/configuracao', jwt, {
        janelaInicio: '09:30',
        janelaFim: '18:00',
        dias: [1, 2, 3, 4, 5],
      }),
    )
    expect(res.status).toBe(200)

    const p = await perfil(tenantId)
    expect(p.automation_window_start.slice(0, 5)).toBe('09:30')
    expect(p.automation_window_end.slice(0, 5)).toBe('18:00')
    expect(p.automation_weekdays).toEqual([1, 2, 3, 4, 5])
  })

  it('a mesma segunda marcada duas vezes entra uma vez só, e ordenada', async () => {
    const { PATCH } = await import('@/app/api/automacoes/configuracao/route')
    const res = await PATCH(
      req('http://localhost/api/automacoes/configuracao', jwt, {
        janelaInicio: '08:00',
        janelaFim: '20:00',
        dias: [3, 1, 1, 2],
      }),
    )
    expect(res.status).toBe(200)
    expect((await perfil(tenantId)).automation_weekdays).toEqual([1, 2, 3])
  })

  /**
   * Lista vazia é ACEITA de propósito: "não enviar em dia nenhum" é uma forma
   * legítima de pausar tudo sem desligar automação por automação, e recusá-la
   * obrigaria a clínica a desligar sete coisas para conseguir o mesmo silêncio.
   */
  it('nenhum dia permitido é aceito — é como se pausa tudo', async () => {
    const { PATCH } = await import('@/app/api/automacoes/configuracao/route')
    const res = await PATCH(
      req('http://localhost/api/automacoes/configuracao', jwt, {
        janelaInicio: '08:00',
        janelaFim: '20:00',
        dias: [],
      }),
    )
    expect(res.status).toBe(200)
    expect((await perfil(tenantId)).automation_weekdays).toEqual([])
  })

  it('janela invertida é recusada', async () => {
    const { PATCH } = await import('@/app/api/automacoes/configuracao/route')
    const res = await PATCH(
      req('http://localhost/api/automacoes/configuracao', jwt, {
        janelaInicio: '20:00',
        janelaFim: '08:00',
        dias: [1],
      }),
    )
    expect(res.status).toBe(400)
  })

  it('dia fora de 0..6 é recusado', async () => {
    const { PATCH } = await import('@/app/api/automacoes/configuracao/route')
    const res = await PATCH(
      req('http://localhost/api/automacoes/configuracao', jwt, {
        janelaInicio: '08:00',
        janelaFim: '20:00',
        dias: [7],
      }),
    )
    expect(res.status).toBe(400)
  })
})

// ===========================================================================
// 2. A conta de capacidade da prévia
// ===========================================================================

describe('Feature 056 — capacidade do dia na prévia', () => {
  let tenantId: string

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedClinica('auto-previa')).tenantId
  })

  /**
   * O aviso de volume mudou de pergunta quando o teto virou espaçamento. Antes
   * comparava com o teto por ciclo (50) e passar dele significava "leva mais de
   * um dia". Com o teto em 1 e o ciclo de 5 minutos, comparar com ele acusaria
   * volume demais para DOIS aniversariantes — que levam cinco minutos e cabem
   * folgados. O que importa é se a fila vaza dentro da janela.
   */
  it('a capacidade é a janela dividida pelo ciclo, vezes o teto', async () => {
    await sb
      .from('tenant_clinic_profile' as never)
      .update({
        automation_window_start: '08:00',
        automation_window_end: '20:00',
        automation_max_per_cycle: 1,
      } as never)
      .eq('tenant_id', tenantId)
      .throwOnError()

    const p = await previewSource(sb, tenantId, 'aniversario', {})
    // 12 horas = 720 minutos / 5 por ciclo = 144 janelas, 1 mensagem cada.
    expect(p.capacidadeDoDia).toBe(144)
    expect(p.tetoPorCiclo).toBe(1)
  })

  it('janela menor reduz a capacidade proporcionalmente', async () => {
    await sb
      .from('tenant_clinic_profile' as never)
      .update({ automation_window_start: '09:00', automation_window_end: '10:00' } as never)
      .eq('tenant_id', tenantId)
      .throwOnError()

    const p = await previewSource(sb, tenantId, 'aniversario', {})
    // 1 hora = 60 minutos / 5 = 12.
    expect(p.capacidadeDoDia).toBe(12)
  })

  it('sem candidato, não há fila nem aviso', async () => {
    const p = await previewSource(sb, tenantId, 'aniversario', {})
    expect(p.candidatosHoje).toBe(0)
    expect(p.minutosDeFila).toBe(0)
    expect(p.avisoVolume).toBe(false)
  })

  it('fonte desconhecida é recusada em vez de devolver zero', async () => {
    // Zero seria pior que o erro: a clínica leria "não atinge ninguém" sobre
    // uma fonte que nem existe, e concluiria que o gatilho está calibrado.
    await expect(previewSource(sb, tenantId, 'nao_existe', {})).rejects.toThrow(
      'FONTE_DESCONHECIDA',
    )
  })
})

// ===========================================================================
// 3. A automação criada num ato só, com o gatilho nascendo por baixo
// ===========================================================================

describe('Feature 056 — criação da automação num ato só', () => {
  let tenantId: string
  let jwt: string
  let mensagemId: string

  beforeAll(async () => {
    await resetDatabase()
    const c = await seedClinica('auto-ato-unico')
    tenantId = c.tenantId
    jwt = c.jwt
    const { data } = await sb
      .from('message_templates' as never)
      .insert({ tenant_id: tenantId, name: 'Parabéns', body: 'Oi {{paciente}}' } as never)
      .select('id')
      .single()
    mensagemId = (data as unknown as { id: string }).id
  })

  async function criar(body: Record<string, unknown>) {
    const { POST } = await import('@/app/api/automacoes/route')
    return POST(req('http://localhost/api/automacoes', jwt, body, 'POST'))
  }

  async function gatilhos() {
    const { data } = await sb
      .from('automation_triggers' as never)
      .select('id, name, source, params')
      .eq('tenant_id', tenantId)
    return (data ?? []) as Array<{ id: string; name: string; source: string; params: unknown }>
  }

  it('cria a automação E o gatilho, com nome derivado da fonte', async () => {
    const res = await criar({
      name: 'Parabéns do dia',
      messageTemplateId: mensagemId,
      source: 'aniversario',
      params: { quando: 'no_dia' },
      sendAtLocal: '10:00',
    })
    expect(res.status).toBe(201)

    const g = await gatilhos()
    expect(g).toHaveLength(1)
    // O nome do gatilho é interno, mas precisa identificar a coisa: "Gatilho 1"
    // obrigaria quem lê o log a abrir o banco para saber do que se fala.
    expect(g[0]?.name).toContain('Aniversário')
    expect(g[0]?.source).toBe('aniversario')
  })

  /**
   * O gatilho é a unidade de ENUMERAÇÃO do motor. Duplicá-lo faria a mesma
   * varredura rodar duas vezes por ciclo, dobrando a consulta mais cara da
   * feature — por isso "mesmo quando" tem que reaproveitar a mesma linha.
   */
  it('a segunda automação com o MESMO quando reaproveita o gatilho', async () => {
    const { data } = await sb
      .from('message_templates' as never)
      .insert({ tenant_id: tenantId, name: 'Outra', body: 'Olá {{paciente}}' } as never)
      .select('id')
      .single()
    const outraMensagem = (data as unknown as { id: string }).id

    const res = await criar({
      name: 'Parabéns, outra mensagem',
      messageTemplateId: outraMensagem,
      source: 'aniversario',
      params: { quando: 'no_dia' },
    })
    expect(res.status).toBe(201)
    expect(await gatilhos()).toHaveLength(1)
  })

  it('quando DIFERENTE cria gatilho próprio', async () => {
    const { data } = await sb
      .from('message_templates' as never)
      .insert({ tenant_id: tenantId, name: 'Antes', body: 'Olá {{paciente}}' } as never)
      .select('id')
      .single()
    const msg = (data as unknown as { id: string }).id

    const res = await criar({
      name: 'Aviso antecipado',
      messageTemplateId: msg,
      source: 'aniversario',
      params: { quando: 'antes', dias: 7 },
    })
    expect(res.status).toBe(201)
    expect(await gatilhos()).toHaveLength(2)
  })

  it('nome repetido na mesma clínica é recusado', async () => {
    const res = await criar({
      name: 'Parabéns do dia',
      messageTemplateId: mensagemId,
      source: 'aniversario',
      params: { quando: 'no_dia' },
    })
    expect(res.status).toBe(409)
  })

  it('parâmetro que a fonte não aceita é recusado antes de gravar', async () => {
    const antes = (await gatilhos()).length
    const res = await criar({
      name: 'Inválida',
      messageTemplateId: mensagemId,
      source: 'aniversario',
      params: { quando: 'quinta-feira' },
    })
    expect(res.status).toBe(400)
    // E não deixa gatilho órfão para trás.
    expect(await gatilhos()).toHaveLength(antes)
  })

  it('a automação nasce DESLIGADA', async () => {
    const { data } = await sb
      .from('automations' as never)
      .select('active')
      .eq('tenant_id', tenantId)
    for (const a of (data ?? []) as Array<{ active: boolean }>) {
      expect(a.active).toBe(false)
    }
  })
})

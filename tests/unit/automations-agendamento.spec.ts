/**
 * Feature 056 — quando cada automação roda, e em que janela.
 *
 * É a regra que o ciclo de 15 em 15 minutos trouxe, e a mais fácil de errar em
 * silêncio: errar para mais faz a mesma varredura rodar 96 vezes por dia
 * (ninguém recebe mensagem duplicada, porque o UNIQUE do banco recusa, mas a
 * clínica paga a consulta mais cara da feature toda hora); errar para menos faz
 * a automação simplesmente não sair, sem nada no log dizendo por quê.
 */

import { describe, expect, it } from 'vitest'
import { agendar } from '@/lib/core/automations/evaluate'
import {
  ancorada,
  duracaoTexto,
  ehAncorada,
  emDias,
  janelaAncorada,
  antecedenciaSchema,
  MINUTOS_POR_DIA,
} from '@/lib/core/automations/sources/shared'

const TZ = 'America/Sao_Paulo'

/** 14:30 em São Paulo é 17:30 UTC. */
const AS_14H30 = new Date('2026-08-13T17:30:00.000Z')
const HOJE = '2026-08-13'

function auto(over: Partial<Parameters<typeof agendar>[0]> = {}) {
  return {
    params: {},
    sendAtLocal: '09:00',
    lastFiredOn: null,
    lastRanAt: null,
    ...over,
  }
}

describe('automação diária', () => {
  it('roda quando o horário escolhido já passou e ainda não rodou hoje', () => {
    const p = agendar(auto({ sendAtLocal: '09:00' }), false, AS_14H30, TZ, HOJE)
    expect(p.rodar).toBe(true)
    expect(p.firedOn).toBe(HOJE)
  })

  it('não roda antes do horário escolhido', () => {
    const p = agendar(auto({ sendAtLocal: '18:00' }), false, AS_14H30, TZ, HOJE)
    expect(p.rodar).toBe(false)
  })

  it('não roda de novo no mesmo dia', () => {
    const p = agendar(auto({ sendAtLocal: '09:00', lastFiredOn: HOJE }), false, AS_14H30, TZ, HOJE)
    expect(p.rodar).toBe(false)
  })

  it('volta a rodar no dia seguinte', () => {
    const p = agendar(
      auto({ sendAtLocal: '09:00', lastFiredOn: '2026-08-12' }),
      false,
      AS_14H30,
      TZ,
      HOJE,
    )
    expect(p.rodar).toBe(true)
  })

  /**
   * O horário é o do relógio DA CLÍNICA, não o do servidor. Sem o fuso, uma
   * automação das 09:00 em São Paulo rodaria às 06:00 locais (09:00 UTC) — três
   * horas antes de a clínica abrir, e a mensagem chegaria de madrugada para
   * quem estivesse no Acre.
   */
  it('compara com o relógio da clínica, não com o UTC', () => {
    // 11:00 UTC é 08:00 em São Paulo: ainda não deu 09:00 local.
    const antes = agendar(auto(), false, new Date('2026-08-13T11:00:00.000Z'), TZ, HOJE)
    expect(antes.rodar).toBe(false)
    // 13:00 UTC é 10:00 em São Paulo.
    const depois = agendar(auto(), false, new Date('2026-08-13T13:00:00.000Z'), TZ, HOJE)
    expect(depois.rodar).toBe(true)
  })
})

describe('automação ancorada num horário', () => {
  it('roda em todo ciclo, com a janela desde a varredura anterior', () => {
    const anterior = new Date(AS_14H30.getTime() - 15 * 60_000)
    const p = agendar(auto({ lastRanAt: anterior.toISOString() }), true, AS_14H30, TZ, HOJE)
    expect(p.rodar).toBe(true)
    expect(p.windowFrom.toISOString()).toBe(anterior.toISOString())
    // Nunca fecha o dia: ela precisa rodar de novo daqui a 15 minutos.
    expect(p.firedOn).toBeNull()
  })

  it('na primeira vez, assume a janela de um ciclo', () => {
    const p = agendar(auto(), true, AS_14H30, TZ, HOJE)
    expect(p.rodar).toBe(true)
    // Um ciclo é de 5 minutos — a mesma cadência do pg_cron, que é também o
    // espaçamento entre duas mensagens da clínica.
    expect(AS_14H30.getTime() - p.windowFrom.getTime()).toBe(5 * 60_000)
  })

  /**
   * O teto de seis horas é o que impede o ciclo, depois de um dia parado, de
   * despejar de uma vez avisos cujo momento já passou — "sua consulta é daqui a
   * duas horas" sobre uma consulta de anteontem.
   */
  it('limita a janela a seis horas depois de uma parada longa', () => {
    const tresDiasAtras = new Date(AS_14H30.getTime() - 3 * 24 * 3600_000)
    const p = agendar(auto({ lastRanAt: tresDiasAtras.toISOString() }), true, AS_14H30, TZ, HOJE)
    expect(AS_14H30.getTime() - p.windowFrom.getTime()).toBe(6 * 3600_000)
  })

  it('não roda com janela vazia ou invertida', () => {
    const futuro = new Date(AS_14H30.getTime() + 60_000)
    const p = agendar(auto({ lastRanAt: futuro.toISOString() }), true, AS_14H30, TZ, HOJE)
    expect(p.rodar).toBe(false)
  })

  it('ignora o horário escolhido — quem manda é a âncora', () => {
    const p = agendar(auto({ sendAtLocal: '23:00' }), true, AS_14H30, TZ, HOJE)
    expect(p.rodar).toBe(true)
  })
})

describe('antecedência em minutos', () => {
  it('só é ancorada quando não fecha em dias inteiros', () => {
    expect(ehAncorada(120)).toBe(true)
    expect(ehAncorada(30)).toBe(true)
    expect(ehAncorada(MINUTOS_POR_DIA)).toBe(false)
    expect(ehAncorada(2 * MINUTOS_POR_DIA)).toBe(false)
    expect(ehAncorada(0)).toBe(false)
  })

  it('descreve na maior unidade que divide exato', () => {
    expect(duracaoTexto(30)).toBe('30 minutos')
    expect(duracaoTexto(60)).toBe('1 hora')
    expect(duracaoTexto(120)).toBe('2 horas')
    expect(duracaoTexto(MINUTOS_POR_DIA)).toBe('1 dia')
    expect(duracaoTexto(2 * MINUTOS_POR_DIA)).toBe('2 dias')
    expect(duracaoTexto(90)).toBe('90 minutos')
  })

  it('converte para dias inteiros', () => {
    expect(emDias(2 * MINUTOS_POR_DIA)).toBe(2)
    expect(emDias(0)).toBe(0)
  })

  /**
   * 1440 minutos são "1 dia" E "24 horas", e as duas leituras produzem envios
   * diferentes: o lote das 09:00 para todo mundo, ou a contagem a partir do
   * horário de cada paciente. A aritmética sozinha sempre respondeu "dia", e por
   * isso uma automação criada como "24 horas antes" entregava entre 23h50 e
   * 25h30 conforme a hora da consulta (medido em produção, 20/08/2026).
   */
  it('a intenção gravada desempata 1440 minutos; a aritmética responde o resto', () => {
    expect(ancorada({ antecedenciaMin: MINUTOS_POR_DIA, ancorar: true })).toBe(true)
    expect(ancorada({ antecedenciaMin: MINUTOS_POR_DIA })).toBe(false)
    expect(ancorada({ antecedenciaMin: 2 * MINUTOS_POR_DIA, ancorar: false })).toBe(false)
    expect(ancorada({ antecedenciaMin: 240 })).toBe(true)
    expect(ancorada({})).toBe(false)
  })

  it('ancorada nunca se diz em dias — é o texto que vai na mensagem', () => {
    expect(duracaoTexto(MINUTOS_POR_DIA, true)).toBe('24 horas')
    expect(duracaoTexto(2 * MINUTOS_POR_DIA, true)).toBe('48 horas')
    expect(duracaoTexto(MINUTOS_POR_DIA, false)).toBe('1 dia')
  })

  /**
   * O gatilho é reaproveitado por IGUALDADE de parâmetros. Guardar `ancorar`
   * quando ele só repete a aritmética partiria em dois um gatilho que é um só —
   * o antigo, sem a chave, nunca casaria com o novo.
   */
  it('guarda a intenção só quando ela contradiz a aritmética', () => {
    const schema = antecedenciaSchema(0, 60 * MINUTOS_POR_DIA)
    expect(schema.parse({ antecedenciaMin: MINUTOS_POR_DIA, ancorar: true })).toEqual({
      antecedenciaMin: MINUTOS_POR_DIA,
      ancorar: true,
    })
    expect(schema.parse({ antecedenciaMin: 2 * MINUTOS_POR_DIA, ancorar: false })).toEqual({
      antecedenciaMin: 2 * MINUTOS_POR_DIA,
    })
    expect(schema.parse({ antecedenciaMin: 240, ancorar: true })).toEqual({
      antecedenciaMin: 240,
    })
  })

  /**
   * O gatilho gravado antes desta mudança tem `{ dias: 2 }`. Sem a conversão, o
   * `.strict()` recusaria a linha e a automação pararia de mandar sem nada na
   * tela explicando — a clínica veria uma automação ligada e muda.
   */
  it('aceita o formato antigo em dias e converte para minutos', () => {
    const schema = antecedenciaSchema(0, 60 * MINUTOS_POR_DIA)
    const v = schema.parse({ dias: 2 })
    expect(v).toEqual({ antecedenciaMin: 2 * MINUTOS_POR_DIA })
  })

  it('recusa parâmetro fora da faixa da fonte', () => {
    const schema = antecedenciaSchema(15, 60 * MINUTOS_POR_DIA)
    expect(schema.safeParse({ antecedenciaMin: 5 }).success).toBe(false)
    expect(schema.safeParse({ antecedenciaMin: 15 }).success).toBe(true)
  })

  /**
   * A janela desloca no sentido certo: para avisar 2 horas ANTES, o ciclo das
   * 14:00 procura consultas marcadas para as 16:00 — e não consultas de agora.
   */
  it('desloca a janela para frente quando o aviso é antes da âncora', () => {
    const ctx = {
      windowFrom: new Date('2026-08-13T17:00:00.000Z'),
      now: new Date('2026-08-13T17:15:00.000Z'),
    } as never
    const { de, ate } = janelaAncorada(ctx, 120, 'antes')
    expect(de).toBe('2026-08-13T19:00:00.000Z')
    expect(ate).toBe('2026-08-13T19:15:00.000Z')
  })

  it('desloca para trás quando o aviso é depois da âncora', () => {
    const ctx = {
      windowFrom: new Date('2026-08-13T17:00:00.000Z'),
      now: new Date('2026-08-13T17:15:00.000Z'),
    } as never
    const { de, ate } = janelaAncorada(ctx, 120, 'depois')
    expect(de).toBe('2026-08-13T15:00:00.000Z')
    expect(ate).toBe('2026-08-13T15:15:00.000Z')
  })

  /**
   * O atraso de uma mensagem ancorada é o tamanho desta janela, então a borda de
   * trás é o teto da mentira. Depois da janela de silêncio da noite, a varredura
   * das 08:00 alcançava seis horas de âncoras vencidas e entregava todas com o
   * texto original: a consulta das 10:20, cuja hora de avisar era 06:20, saía às
   * 08:50 dizendo "4 horas". O que passa do teto é descartado.
   */
  it('não alcança âncora vencida além do atraso máximo', () => {
    const now = new Date('2026-08-13T11:00:00.000Z')
    const ctx = {
      // Seis horas sem varrer — a noite inteira dentro da janela de silêncio.
      windowFrom: new Date('2026-08-13T05:00:00.000Z'),
      now,
    } as never
    const { de, ate } = janelaAncorada(ctx, 240, 'antes')
    // Sem o teto, `de` seria 05:00 + 4h = 09:00, e a consulta das 09:00 (avisada
    // com 4h de atraso) entraria. Com o teto, a borda é 10:30 + 4h.
    expect(de).toBe('2026-08-13T14:30:00.000Z')
    expect(ate).toBe('2026-08-13T15:00:00.000Z')
  })

  it('o teto não encurta a janela de um ciclo normal', () => {
    const ctx = {
      windowFrom: new Date('2026-08-13T17:10:00.000Z'),
      now: new Date('2026-08-13T17:15:00.000Z'),
    } as never
    const { de } = janelaAncorada(ctx, 120, 'antes')
    expect(de).toBe('2026-08-13T19:10:00.000Z')
  })

  /**
   * A prévia mede o dia inteiro para responder "quantos isso pega?". Sob o teto
   * de atraso ela responderia pela meia hora anterior, e a clínica ligaria às
   * cegas uma automação que vai falar com a base toda.
   */
  it('a prévia não sofre o teto de atraso', () => {
    const ctx = {
      windowFrom: new Date('2026-08-13T03:00:00.000Z'),
      now: new Date('2026-08-14T03:00:00.000Z'),
      previewMode: true,
    } as never
    const { de } = janelaAncorada(ctx, 120, 'antes')
    expect(de).toBe('2026-08-13T05:00:00.000Z')
  })
})

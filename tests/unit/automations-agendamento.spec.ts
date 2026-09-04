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
  devidaAgora,
  duracaoTexto,
  ehAncorada,
  emDias,
  janelaAncorada,
  mesmoDiaCivil,
  podeDesde,
  textoAntecedencia,
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
   * A janela SQL deixou de ser o corte e virou superconjunto: quem decide é
   * `devidaAgora`, porque a decisão depende de quando cada linha nasceu — e
   * isso não cabe num intervalo sobre a coluna de data do evento.
   *
   * No sentido "antes" ela traz TODA consulta futura dentro da antecedência. É
   * o que faz a consulta lançada em cima da hora ser alcançada: a âncora dela
   * já nasce vencida, e nenhum intervalo ancorado na varredura anterior a
   * encontraria.
   */
  it('traz toda consulta futura dentro da antecedência', () => {
    const ctx = {
      windowFrom: new Date('2026-08-13T17:00:00.000Z'),
      now: new Date('2026-08-13T17:15:00.000Z'),
    } as never
    const { de, ate } = janelaAncorada(ctx, 120, 'antes')
    expect(de).toBe('2026-08-13T17:15:00.000Z')
    expect(ate).toBe('2026-08-13T19:15:00.000Z')
  })

  it('olha 16 horas para trás quando o aviso é depois da âncora', () => {
    const ctx = {
      windowFrom: new Date('2026-08-13T17:00:00.000Z'),
      now: new Date('2026-08-13T17:15:00.000Z'),
    } as never
    const { de, ate } = janelaAncorada(ctx, 120, 'depois')
    expect(ate).toBe('2026-08-13T15:15:00.000Z')
    // 17:15 − 16h − 2h de deslocamento. Cobre a noite inteira de silêncio, que
    // é o buraco que a liberação do represado precisa enxergar.
    expect(de).toBe('2026-08-12T23:15:00.000Z')
  })

  /**
   * A prévia mede o dia inteiro para responder "quantos isso pega?". Sob o teto
   * de atraso ela responderia pela meia hora anterior, e a clínica ligaria às
   * cegas uma automação que vai falar com a base toda.
   */
  it('a prévia continua medindo o dia que lhe foi entregue', () => {
    const ctx = {
      windowFrom: new Date('2026-08-13T03:00:00.000Z'),
      now: new Date('2026-08-14T03:00:00.000Z'),
      previewMode: true,
    } as never
    const { de } = janelaAncorada(ctx, 120, 'antes')
    expect(de).toBe('2026-08-13T05:00:00.000Z')
  })
})

/**
 * O corte de quem está devido — a correção de 04/09/2026.
 *
 * O teto de atraso contava do instante da âncora e por isso punia a mensagem
 * por tempo em que o motor nunca teve como agir. Numa clínica com janela a
 * partir das 08:00 e aviso de 4 horas, nenhuma consulta antes das 12:00 recebia:
 * a âncora das 06:00 vencia com o motor calado e chegava às 08:00 já fora do
 * teto. Agora o relógio conta de `podeDesde`.
 */
describe('quem está devido neste ciclo', () => {
  /** 08:00 em São Paulo é 11:00 UTC. */
  const ABERTURA = new Date('2026-08-13T11:00:00.000Z')

  function ctxDe(over: Record<string, unknown> = {}) {
    return {
      windowFrom: new Date('2026-08-13T05:00:00.000Z'),
      now: new Date('2026-08-13T11:00:00.000Z'),
      janelaAbertaDesde: ABERTURA,
      timezone: TZ,
      ...over,
    } as never
  }

  it('o instante possível é o maior entre âncora, nascimento e abertura', () => {
    const ancora = new Date('2026-08-13T09:00:00.000Z')
    const abertura = ABERTURA
    expect(podeDesde({ ancora, janelaAbertaDesde: abertura }).toISOString()).toBe(
      abertura.toISOString(),
    )

    const nasceu = new Date('2026-08-13T12:30:00.000Z')
    expect(podeDesde({ ancora, nasceuEm: nasceu, janelaAbertaDesde: abertura }).toISOString()).toBe(
      nasceu.toISOString(),
    )

    const tarde = new Date('2026-08-13T14:00:00.000Z')
    expect(podeDesde({ ancora: tarde, janelaAbertaDesde: abertura }).toISOString()).toBe(
      tarde.toISOString(),
    )
  })

  /**
   * O caso que estava perdendo mensagem todo dia: consulta às 10:00 da manhã,
   * aviso de 4 horas, âncora às 06:00 — dentro da janela de silêncio. O motor
   * nem varre antes das 08:00, e quando varre a âncora já tem duas horas.
   */
  it('libera na abertura da janela o que venceu durante o silêncio', () => {
    const ancora = new Date('2026-08-13T09:00:00.000Z') // 06:00 local
    expect(devidaAgora(ctxDe(), ancora)).toBe(true)
  })

  /**
   * O represado escoa a uma mensagem por ciclo. Se o teto de meia hora valesse
   * aqui, uma manhã de dez consultas perderia as quatro últimas — o mesmo
   * defeito com outro disfarce. Quem freia é `markAutomationRan`, que não
   * avança a marca de varredura enquanto sobrar alguém na fila.
   */
  it('mantém a fila represada aberta enquanto a varredura não avançou', () => {
    const ancora = new Date('2026-08-13T09:00:00.000Z')
    // Uma hora depois da abertura, com a marca de varredura ainda na véspera.
    const ctx = ctxDe({ now: new Date('2026-08-13T12:00:00.000Z') })
    expect(devidaAgora(ctx, ancora)).toBe(true)
  })

  it('e fecha o represado no ciclo em que a fila esvaziou', () => {
    const ancora = new Date('2026-08-13T09:00:00.000Z')
    const ctx = ctxDe({
      // A fila acabou às 08:20 local e a marca avançou.
      windowFrom: new Date('2026-08-13T11:20:00.000Z'),
      now: new Date('2026-08-13T11:25:00.000Z'),
    })
    expect(devidaAgora(ctx, ancora)).toBe(false)
  })

  /**
   * A segunda causa medida na clínica Thiago Padilha, e a maior: a agenda do
   * dia é digitada na tarde anterior, ou no próprio dia. A âncora já nasce
   * vencida e nenhuma varredura a alcançava.
   */
  it('alcança a consulta lançada depois da própria âncora', () => {
    const ancora = new Date('2026-08-13T16:00:00.000Z')
    const nasceu = new Date('2026-08-13T17:58:00.000Z')
    const ctx = ctxDe({
      windowFrom: new Date('2026-08-13T17:55:00.000Z'),
      now: new Date('2026-08-13T18:00:00.000Z'),
    })
    expect(devidaAgora(ctx, ancora, nasceu)).toBe(true)
  })

  /**
   * O teto continua fazendo o trabalho para o qual foi criado: cortar a cauda
   * de uma fila escoando devagar. É o caso de 20/08/2026 — âncora vencida com o
   * motor acordado e liberado.
   */
  it('descarta a âncora que o motor deixou passar estando acordado', () => {
    const ancora = new Date('2026-08-13T14:00:00.000Z') // 11:00 local
    const ctx = ctxDe({
      windowFrom: new Date('2026-08-13T13:00:00.000Z'),
      now: new Date('2026-08-13T15:00:00.000Z'), // 12:00 local, uma hora depois
    })
    expect(devidaAgora(ctx, ancora)).toBe(false)
  })

  it('a âncora que ainda não venceu não é candidata', () => {
    const ancora = new Date('2026-08-13T20:00:00.000Z')
    expect(devidaAgora(ctxDe(), ancora)).toBe(false)
  })

  it('a mesma âncora pertence a um ciclo só', () => {
    const ancora = new Date('2026-08-13T17:10:00.000Z')
    const ctx = ctxDe({
      windowFrom: new Date('2026-08-13T17:10:00.000Z'),
      now: new Date('2026-08-13T17:15:00.000Z'),
    })
    // Fronteira fechada no fim, aberta no início: quem caiu exatamente no corte
    // já foi enumerado pelo ciclo anterior.
    expect(devidaAgora(ctx, ancora)).toBe(false)
    expect(devidaAgora(ctx, new Date('2026-08-13T17:11:00.000Z'))).toBe(true)
  })
})

/**
 * O guarda-corpo de liberar mensagem represada: o texto de uma automação
 * ancorada é relativo ao dia ("hoje às 10h", "sua consulta Amanhã"), e essa
 * palavra foi escrita contando com o dia em que a âncora vence.
 */
describe('a entrega honra o dia que a âncora pretendia', () => {
  it('reconhece o mesmo dia civil no fuso da clínica', () => {
    // 21:00 local de 13/08 e 09:00 local de 13/08 — o mesmo dia da clínica,
    // embora o primeiro já seja 14/08 em UTC.
    expect(
      mesmoDiaCivil(new Date('2026-08-14T00:00:00.000Z'), new Date('2026-08-13T12:00:00.000Z'), TZ),
    ).toBe(true)
    expect(
      mesmoDiaCivil(new Date('2026-08-13T12:00:00.000Z'), new Date('2026-08-14T12:00:00.000Z'), TZ),
    ).toBe(false)
  })
})

/**
 * A permissividade nova só é defensável porque a mensagem passa a dizer a
 * verdade sobre si mesma.
 */
describe('o texto de {{antecedencia}}', () => {
  it('não muda a palavra de nenhuma mensagem que já saía', () => {
    // Escoamento normal da fila: dentro da tolerância, o texto é o configurado.
    expect(textoAntecedencia(240, 235, true)).toBe('4 horas')
    expect(textoAntecedencia(240, 240, true)).toBe('4 horas')
    // Não ancorada continua lendo em dias, como sempre.
    expect(textoAntecedencia(2 * MINUTOS_POR_DIA, 999, false)).toBe('2 dias')
  })

  it('diz a distância REAL quando a entrega é de um represado', () => {
    // Consulta às 10:00 avisada às 08:00 por uma automação de 4 horas.
    expect(textoAntecedencia(240, 120, true)).toBe('2 horas')
    expect(textoAntecedencia(240, 55, true)).toBe('55 minutos')
  })

  it('não esconde o resto arredondando para a hora cheia', () => {
    // O caso de 20/08/2026: entrega a 1h30 de uma automação de 4 horas. Dizer
    // "2 horas" seria a mesma classe de mentira que o teto de atraso barra.
    expect(textoAntecedencia(240, 90, true)).toBe('1h30')
    expect(textoAntecedencia(240, 105, true)).toBe('1h45')
  })
})

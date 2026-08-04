/**
 * T040 (Feature 053) — a supressão que impede a feature de cobrar quem sumiu.
 *
 * É o teste mais importante da US2, e talvez da feature. Sem esta regra, o
 * paciente que abandonou o portal receberia cobrança sobre hábitos que talvez
 * esteja cumprindo — uma acusação falsa vinda da clínica em que ele confia, e
 * o tipo de erro que não se desfaz com um pedido de desculpas.
 */
import { describe, expect, it } from 'vitest'
import { decideGate, type GateContext } from '@/lib/core/signals/gates'

const PACIENTE = 'p1'

function ctx(over: Partial<GateContext> = {}): GateContext {
  return {
    emSilencio: new Set(),
    enviadasNaSemana: new Map(),
    cap: 2,
    portal: null,
    decididasNesteCiclo: new Map(),
    ...over,
  }
}

describe('filtro de portal — os dois níveis', () => {
  it('deixa passar quem esteve no portal dentro da janela', () => {
    const d = decideGate(
      PACIENTE,
      ctx({
        portal: { elegiveis: new Set([PACIENTE]), ativosNaJanela: new Set([PACIENTE]) },
      }),
    )
    expect(d).toBeNull()
  })

  it('suprime quem não entrou no portal dentro da janela', () => {
    // Ausência de registro de quem não entrou não informa nada sobre o que ele
    // fez — cobrá-lo seria inventar a conclusão.
    const d = decideGate(
      PACIENTE,
      ctx({ portal: { elegiveis: new Set([PACIENTE]), ativosNaJanela: new Set() } }),
    )
    expect(d).toBe('suprimida_sem_portal')
  })

  it('suprime quem NUNCA entrou no portal — não é sumido, é outro público', () => {
    const d = decideGate(
      PACIENTE,
      ctx({ portal: { elegiveis: new Set(), ativosNaJanela: new Set() } }),
    )
    expect(d).toBe('suprimida_sem_portal')
  })

  it('famílias sem requiresPortalActivity não passam pelo filtro', () => {
    // `sem_acesso_portal` é justamente quem observa o sumiço; aplicar o filtro
    // nela anularia a própria família.
    expect(decideGate(PACIENTE, ctx({ portal: null }))).toBeNull()
  })
})

describe('ordem dos portões', () => {
  /**
   * Portal antes de silêncio, silêncio antes de teto. Um paciente suprimido
   * por falta de atividade no portal não deveria consumir vaga do teto nem
   * gastar a janela de silêncio — ele nunca esteve elegível a receber.
   */
  it('supressão de portal tem precedência sobre silêncio', () => {
    const d = decideGate(
      PACIENTE,
      ctx({
        portal: { elegiveis: new Set([PACIENTE]), ativosNaJanela: new Set() },
        emSilencio: new Set([PACIENTE]),
      }),
    )
    expect(d).toBe('suprimida_sem_portal')
  })

  it('silêncio tem precedência sobre teto', () => {
    const d = decideGate(
      PACIENTE,
      ctx({ emSilencio: new Set([PACIENTE]), enviadasNaSemana: new Map([[PACIENTE, 5]]) }),
    )
    expect(d).toBe('silenciada')
  })
})

describe('teto semanal', () => {
  it('deixa passar quem ainda não atingiu o teto', () => {
    expect(decideGate(PACIENTE, ctx({ enviadasNaSemana: new Map([[PACIENTE, 1]]) }))).toBeNull()
  })

  it('adia quem atingiu o teto', () => {
    const d = decideGate(PACIENTE, ctx({ enviadasNaSemana: new Map([[PACIENTE, 2]]) }))
    expect(d).toBe('adiada')
  })

  /**
   * Sem isto, três regras aplicáveis ao mesmo paciente furariam o teto todas de
   * uma vez, cada uma achando que ainda havia vaga — o bug clássico de contar
   * só o passado num laço que também produz.
   */
  it('decisões DESTE ciclo contam para o teto junto com as da semana', () => {
    const d = decideGate(
      PACIENTE,
      ctx({
        enviadasNaSemana: new Map([[PACIENTE, 1]]),
        decididasNesteCiclo: new Map([[PACIENTE, 1]]),
      }),
    )
    expect(d).toBe('adiada')
  })

  it('teto 1 deixa passar exatamente uma', () => {
    const c = ctx({ cap: 1 })
    expect(decideGate(PACIENTE, c)).toBeNull()
    c.decididasNesteCiclo.set(PACIENTE, 1)
    expect(decideGate(PACIENTE, c)).toBe('adiada')
  })

  it('o teto é por paciente, não global — outro paciente não é afetado', () => {
    const c = ctx({ enviadasNaSemana: new Map([[PACIENTE, 9]]) })
    expect(decideGate('outro', c)).toBeNull()
  })
})

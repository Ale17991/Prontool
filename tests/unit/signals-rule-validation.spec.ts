/**
 * Feature 053 — o guard do caminho de escrita.
 *
 * `validateRule` é o que impede uma regra impossível ou uma mensagem
 * acusatória de chegar ao banco. Como o CHECK do Postgres sabe dizer "família
 * inválida" mas não sabe dizer "o campo {{peso}} não existe nesta família",
 * esta camada é a única que produz erro acionável pela clínica.
 */
import { describe, expect, it } from 'vitest'
import { validateRule, type RuleInput } from '@/lib/core/signals/rules'

const BASE: RuleInput = {
  family: 'habito_sem_registro',
  params: { days: 3 },
  audience: 'todos_ativos',
  audienceDoctorId: null,
  channel: 'preferencial',
  messageTemplate: 'Oi {{paciente}}, não vimos seu registro de {{habito}}. — {{clinica}}',
  silenceDays: 7,
}

const com = (over: Partial<RuleInput>): RuleInput => ({ ...BASE, ...over })

describe('validateRule — aceita o caminho feliz', () => {
  it('regra válida passa', () => {
    expect(validateRule(BASE)).toBeNull()
  })
})

describe('validateRule — família', () => {
  it('recusa família inexistente', () => {
    expect(validateRule(com({ family: 'nao_existe' }))?.code).toBe('UNKNOWN_FAMILY')
  })

  /**
   * Família definida no catálogo mas sem `evaluate` ainda. Aceitar aqui
   * deixaria a clínica ligando uma regra e esperando uma mensagem que o ciclo
   * não sabe produzir — pior que o botão não existir.
   */
  it('recusa família ainda não implementada', () => {
    const r = validateRule(
      com({
        family: 'sem_retorno',
        params: { months: 6 },
        messageTemplate: 'Oi {{paciente}}, faz {{meses}} meses. — {{clinica}}',
      }),
    )
    expect(r?.code).toBe('FAMILY_NOT_AVAILABLE')
  })

  it('aceita família de celebração já implementada', () => {
    const r = validateRule(
      com({
        family: 'aniversario',
        params: {},
        messageTemplate: 'Oi {{paciente}}, feliz aniversário! — {{clinica}}',
      }),
    )
    expect(r).toBeNull()
  })
})

describe('validateRule — parâmetros', () => {
  it('recusa params fora da faixa da família', () => {
    expect(validateRule(com({ params: { days: 1 } }))?.code).toBe('INVALID_PARAMS')
    expect(validateRule(com({ params: {} }))?.code).toBe('INVALID_PARAMS')
  })
})

describe('validateRule — texto', () => {
  it('recusa placeholder que a família não oferece, e diz qual', () => {
    const r = validateRule(
      com({ messageTemplate: 'Oi {{paciente}}, seu {{peso}} subiu. — {{clinica}}' }),
    )
    expect(r?.code).toBe('UNKNOWN_PLACEHOLDER')
    expect(r && 'campos' in r ? r.campos : []).toEqual(['peso'])
  })

  it('recusa frase acusatória em família de ausência, e aponta o trecho', () => {
    const r = validateRule(
      com({ messageTemplate: 'Oi {{paciente}}, você não fez {{habito}}. — {{clinica}}' }),
    )
    expect(r?.code).toBe('FORBIDDEN_PHRASE')
    expect(r && 'trecho' in r ? r.trecho.toLowerCase() : '').toContain('não fez')
    expect(r && 'sugestao' in r ? r.sugestao.length : 0).toBeGreaterThan(0)
  })

  it('a ordem da validação vai da família ao texto', () => {
    // Família inexistente com texto acusatório reclama da FAMÍLIA: mandar a
    // clínica reescrever o texto de uma regra que não existe faria ela
    // consertar a coisa errada.
    const r = validateRule(
      com({ family: 'nao_existe', messageTemplate: 'Você não fez nada.' }),
    )
    expect(r?.code).toBe('UNKNOWN_FAMILY')
  })
})

describe('validateRule — público e silêncio', () => {
  it('recusa público por profissional sem profissional', () => {
    expect(validateRule(com({ audience: 'por_profissional' }))?.code).toBe('INVALID_AUDIENCE')
  })

  it('recusa profissional preenchido em público de todos', () => {
    // Sem isto a regra fica ambígua para sempre: ninguém sabe se o autor quis
    // segmentar e errou o público, ou o contrário.
    const r = validateRule(
      com({ audience: 'todos_ativos', audienceDoctorId: '33333333-3333-3333-3333-333333333333' }),
    )
    expect(r?.code).toBe('INVALID_AUDIENCE')
  })

  it('recusa silêncio fora de 1 a 90 dias', () => {
    expect(validateRule(com({ silenceDays: 0 }))?.code).toBe('INVALID_SILENCE')
    expect(validateRule(com({ silenceDays: 91 }))?.code).toBe('INVALID_SILENCE')
    expect(validateRule(com({ silenceDays: 1.5 }))?.code).toBe('INVALID_SILENCE')
  })
})

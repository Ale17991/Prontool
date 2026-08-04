/**
 * T016 (Feature 053) — a rede contra mensagem acusatória.
 *
 * Este teste tem um propósito secundário tão importante quanto o primeiro:
 * DOCUMENTAR O LIMITE. Os casos de "passa apesar de acusar" existem para que
 * ninguém leia FR-008 como barreira forte. A lista pega descuido, não má-fé —
 * a garantia real está nos textos padrão, testados em signals-catalog.spec.ts.
 */
import { describe, expect, it } from 'vitest'
import {
  findForbiddenPhrase,
  hasForbiddenPhrase,
} from '@/lib/core/signals/forbidden-phrases'
import { familiesByNature } from '@/lib/core/signals/catalog'

describe('findForbiddenPhrase — pega a acusação', () => {
  const acusatorias = [
    'Oi Maria, você não fez o exercício esta semana.',
    'Percebemos que você deixou de registrar sua alimentação.',
    'Você não cumpriu o plano combinado.',
    'Você falhou em manter a rotina.',
    'Parece que você esqueceu de beber água.',
    'Você não seguiu as orientações.',
    'Vimos que você abandonou o acompanhamento.',
    'Você desistiu do tratamento?',
    'Você não está cumprindo o combinado.',
    'Você não bebeu água nos últimos dias.',
    'Você anda relaxando com a dieta.',
  ]

  for (const texto of acusatorias) {
    it(`recusa: "${texto.slice(0, 45)}..."`, () => {
      const hit = findForbiddenPhrase(texto)
      expect(hit).not.toBeNull()
      expect(hit!.trecho.length).toBeGreaterThan(0)
      expect(hit!.sugestao.length).toBeGreaterThan(0)
    })
  }

  it('pega a forma impessoal, sem o pronome', () => {
    // "não fez" acusa igual a "você não fez" — a diferença é só de gramática.
    expect(hasForbiddenPhrase('Notamos que não fez as caminhadas.')).toBe(true)
  })

  it('funciona sem acento, que é como muita gente digita', () => {
    expect(hasForbiddenPhrase('Voce nao fez o registro.')).toBe(true)
  })

  it('aponta o trecho exato, para a mensagem de erro poder mostrá-lo', () => {
    const hit = findForbiddenPhrase('Oi Maria, você não fez o exercício.')
    expect(hit!.trecho.toLowerCase()).toContain('não fez')
  })

  it('devolve só a PRIMEIRA ocorrência — lista de doze erros faz procurar como desligar', () => {
    const hit = findForbiddenPhrase('Você não fez, deixou de tentar e falhou.')
    expect(hit).not.toBeNull()
    expect(typeof hit!.trecho).toBe('string')
  })
})

describe('findForbiddenPhrase — não atrapalha texto legítimo', () => {
  const legitimas = [
    'Oi Maria, não vimos seu registro de água nos últimos 3 dias.',
    'Não encontramos um recordatório alimentar recente.',
    'Se estiver tudo certo e só faltou marcar, é só abrir o portal.',
    'Caso tenha faltado marcar, não se preocupe.',
    'Queríamos conversar sobre seu acompanhamento com você.',
    'Faz 6 meses desde sua última consulta.',
  ]

  for (const texto of legitimas) {
    it(`aceita: "${texto.slice(0, 45)}..."`, () => {
      expect(hasForbiddenPhrase(texto)).toBe(false)
    })
  }
})

describe('todos os textos padrão de ausência passam', () => {
  it('nenhuma família de ausência nasce com texto acusatório', () => {
    for (const f of familiesByNature('ausencia')) {
      const hit = findForbiddenPhrase(f.defaultTemplate)
      expect(hit, `${f.id}: "${hit?.trecho}"`).toBeNull()
    }
  })
})

describe('LIMITE CONHECIDO — o que a lista NÃO pega', () => {
  /**
   * Estes casos passam, e passar é o comportamento atual esperado. Estão aqui
   * para que o limite seja explícito no código, e não uma descoberta
   * desagradável em produção. Se um dia quisermos fechá-los, este é o lugar
   * onde a decisão fica visível.
   */
  it('acusação reescrita com outras palavras atravessa a rede', () => {
    expect(hasForbiddenPhrase('Sua dedicação ao tratamento tem sido insuficiente.')).toBe(false)
    expect(hasForbiddenPhrase('Esperávamos mais comprometimento da sua parte.')).toBe(false)
  })

  it('a rede é sobre linguagem, não sobre tom — cobrança educada passa', () => {
    expect(hasForbiddenPhrase('Precisamos que você se esforce mais.')).toBe(false)
  })
})

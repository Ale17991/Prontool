/**
 * Feature 029 (US2/T028) — regras de conteúdo da Guia de Consulta.
 * Puro (sem banco): um rascunho completo passa; lacunas viram pendências
 * legíveis com `field`. Espelha o bloqueio de "Prescrever" da Memed.
 */
import { describe, expect, it } from 'vitest'
import {
  validateConsultaContent,
  type GuiaConsultaDraft,
} from '@/lib/core/tiss/xml/validate-content'

function completo(overrides: Partial<GuiaConsultaDraft> = {}): GuiaConsultaDraft {
  return {
    registroANS: '123456',
    numeroGuiaPrestador: 'G-1',
    numeroCarteira: '00112233',
    atendimentoRN: 'N',
    contractedCode: 'PREST-1',
    cnes: '9999999',
    contratadoIsPJ: false,
    profissional: {
      nome: 'Dra. Ana',
      conselhoCodigo: '06',
      conselhoRaw: 'CRM',
      numeroConselho: '12345',
      ufCodigo: '35',
      ufRaw: 'SP',
      cbo: '225125',
    },
    indicacaoAcidente: '9',
    regimeAtendimento: '01',
    dataAtendimento: '2026-06-09',
    tipoConsulta: '1',
    procedimentos: [{ tabela: '22', codigo: '10101012', valorCents: 25000, tussVigente: true }],
    ...overrides,
  }
}

describe('TISS — validação de conteúdo da Guia de Consulta (US2)', () => {
  it('rascunho completo → sem pendências', () => {
    expect(validateConsultaContent(completo())).toEqual([])
  })

  it('sem carteira → pendência em numeroCarteira', () => {
    const errs = validateConsultaContent(completo({ numeroCarteira: null }))
    expect(errs.some((e) => e.field === 'numeroCarteira')).toBe(true)
  })

  it('sem CBO → pendência em CBOS', () => {
    const errs = validateConsultaContent(
      completo({ profissional: { ...completo().profissional, cbo: null } }),
    )
    expect(errs.some((e) => e.field === 'profissionalExecutante.CBOS')).toBe(true)
  })

  it('conselho não mapeado → pendência citando a sigla', () => {
    const errs = validateConsultaContent(
      completo({ profissional: { ...completo().profissional, conselhoCodigo: null, conselhoRaw: 'XYZ' } }),
    )
    const e = errs.find((x) => x.field === 'profissionalExecutante.conselho')
    expect(e?.message).toContain('XYZ')
  })

  it('PJ sem nome do profissional → pendência', () => {
    const errs = validateConsultaContent(completo({ contratadoIsPJ: true, profissional: { ...completo().profissional, nome: null } }))
    expect(errs.some((e) => e.field === 'profissionalExecutante.nome')).toBe(true)
  })

  it('TUSS fora de vigência → pendência no procedimento', () => {
    const errs = validateConsultaContent(
      completo({ procedimentos: [{ tabela: '22', codigo: '10101012', valorCents: 25000, tussVigente: false }] }),
    )
    expect(errs.some((e) => e.field === 'procedimento[0].codigoProcedimento')).toBe(true)
  })

  it('tipo de consulta inválido → pendência', () => {
    const errs = validateConsultaContent(completo({ tipoConsulta: '9' }))
    expect(errs.some((e) => e.field === 'tipoConsulta')).toBe(true)
  })

  it('sem procedimentos → pendência', () => {
    const errs = validateConsultaContent(completo({ procedimentos: [] }))
    expect(errs.some((e) => e.field === 'procedimento')).toBe(true)
  })
})

/**
 * Feature 029 (US2) — teste-âncora do caminho positivo: o XML renderizado de uma
 * Guia de Consulta valida contra os XSDs oficiais TISS 04.03.00.
 *
 * Não toca no banco — é puro render + validação XSD (xmllint-wasm). É o gate de
 * conformidade do gerador (`render-consulta.ts`): se a sequência/os tipos
 * divergirem do schema da ANS, este teste fica vermelho.
 */
import { describe, expect, it } from 'vitest'
import {
  renderConsultaLoteXml,
  type ConsultaGuiaModel,
  type LoteMensagemModel,
} from '@/lib/core/tiss/xml/render-consulta'
import { validateTissXml } from '@/lib/core/tiss/validate'

function sampleGuia(overrides: Partial<ConsultaGuiaModel> = {}): ConsultaGuiaModel {
  return {
    registroANS: '123456',
    numeroGuiaPrestador: 'G-0001',
    beneficiario: { numeroCarteira: '00112233445566', atendimentoRN: 'N' },
    contratadoExecutante: { codigoPrestadorNaOperadora: 'PREST-001', cnes: '9999999' },
    profissionalExecutante: {
      nome: 'Dra. Ana Souza',
      conselho: '06', // CRM
      numeroConselho: '123456',
      uf: '35', // SP (IBGE)
      cbo: '225125', // Médico clínico
    },
    indicacaoAcidente: '9', // não acidente
    atendimento: {
      regimeAtendimento: '01', // ambulatorial
      dataAtendimento: '2026-06-09',
      tipoConsulta: '1', // primeira
      procedimento: {
        codigoTabela: '22',
        codigoProcedimento: '10101012',
        valorCents: 25000, // R$ 250,00
      },
    },
    ...overrides,
  }
}

function sampleLote(guias: ConsultaGuiaModel[]): LoteMensagemModel {
  return {
    sequencialTransacao: '1',
    dataRegistro: '2026-06-09',
    horaRegistro: '10:30:00',
    origemCnpj: '12345678000199',
    destinoRegistroANS: '123456',
    numeroLote: '1',
    guias,
    hash: 'placeholder',
  }
}

describe('TISS — render Guia de Consulta valida no XSD 04.03.00', () => {
  it('uma guia → mensagemTISS válida', async () => {
    const xml = renderConsultaLoteXml(sampleLote([sampleGuia()]))
    const result = await validateTissXml(xml)
    expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)
  })

  it('múltiplas guias no mesmo lote → válida', async () => {
    const xml = renderConsultaLoteXml(
      sampleLote([
        sampleGuia({ numeroGuiaPrestador: 'G-0001' }),
        sampleGuia({ numeroGuiaPrestador: 'G-0002' }),
      ]),
    )
    const result = await validateTissXml(xml)
    expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)
  })

  it('guia de profissional PF (sem nome) → válida', async () => {
    const xml = renderConsultaLoteXml(
      sampleLote([
        sampleGuia({
          profissionalExecutante: {
            nome: null,
            conselho: '06',
            numeroConselho: '654321',
            uf: '33', // RJ
            cbo: '225125',
          },
        }),
      ]),
    )
    const result = await validateTissXml(xml)
    expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)
  })
})

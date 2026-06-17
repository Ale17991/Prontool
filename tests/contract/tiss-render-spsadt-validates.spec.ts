/**
 * Feature 029 (US3) — teste-âncora: o XML renderizado de uma Guia de SP/SADT
 * (execução) valida contra os XSDs oficiais TISS 04.03.00. Puro render +
 * validação XSD (xmllint-wasm), sem banco.
 */
import { describe, expect, it } from 'vitest'
import {
  renderSpSadtLoteXml,
  type SpSadtGuiaModel,
  type SpSadtLoteModel,
} from '@/lib/core/tiss/xml/render-spsadt'
import { validateTissXml } from '@/lib/core/tiss/validate'

function sampleGuia(overrides: Partial<SpSadtGuiaModel> = {}): SpSadtGuiaModel {
  return {
    registroANS: '123456',
    numeroGuiaPrestador: 'G-0001',
    beneficiario: { numeroCarteira: '00112233445566', atendimentoRN: 'N' },
    codigoPrestadorNaOperadora: 'PREST-001',
    nomeContratado: 'Clínica Exemplo LTDA',
    cnes: '9999999',
    profissional: {
      nome: 'Dra. Ana Souza',
      conselho: '06',
      numeroConselho: '123456',
      uf: '35',
      cbo: '225125',
    },
    caraterAtendimento: '1',
    tipoAtendimento: '04',
    indicacaoAcidente: '9',
    regimeAtendimento: '01',
    procedimentos: [
      {
        sequencial: 1,
        dataExecucao: '2026-06-09',
        codigoTabela: '22',
        codigoProcedimento: '40304361',
        descricao: 'Hemograma completo',
        quantidade: 1,
        valorUnitarioCents: 3500,
        valorTotalCents: 3500,
      },
      {
        sequencial: 2,
        dataExecucao: '2026-06-09',
        codigoTabela: '22',
        codigoProcedimento: '40301010',
        descricao: 'Glicemia de jejum',
        quantidade: 1,
        valorUnitarioCents: 1800,
        valorTotalCents: 1800,
      },
    ],
    ...overrides,
  }
}

function sampleLote(guias: SpSadtGuiaModel[]): SpSadtLoteModel {
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

describe('TISS — render Guia de SP/SADT valida no XSD 04.03.00', () => {
  it('guia com 2 procedimentos → mensagemTISS válida', async () => {
    const xml = renderSpSadtLoteXml(sampleLote([sampleGuia()]))
    const result = await validateTissXml(xml)
    expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)
  })

  it('linha com Via e Técnica preenchidas → válida', async () => {
    const xml = renderSpSadtLoteXml(
      sampleLote([
        sampleGuia({
          procedimentos: [
            {
              sequencial: 1,
              dataExecucao: '2026-06-09',
              codigoTabela: '22',
              codigoProcedimento: '40304361',
              descricao: 'Hemograma completo',
              quantidade: 2,
              viaAcesso: '1',
              tecnicaUtilizada: '1',
              valorUnitarioCents: 3500,
              valorTotalCents: 7000,
            },
          ],
        }),
      ]),
    )
    const result = await validateTissXml(xml)
    expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)
  })
})

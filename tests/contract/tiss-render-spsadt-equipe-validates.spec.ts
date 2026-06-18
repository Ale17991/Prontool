/**
 * T022 (Feature 031, US3) — teste-âncora: SP/SADT com bloco `equipeSadt`
 * (1–2 membros por procedimento) valida contra os XSDs TISS 04.03.00.
 * Puro render + validação XSD (xmllint-wasm), sem banco.
 */
import { describe, expect, it } from 'vitest'
import {
  renderSpSadtLoteXml,
  type SpSadtGuiaModel,
  type SpSadtLoteModel,
} from '@/lib/core/tiss/xml/render-spsadt'
import { validateTissXml } from '@/lib/core/tiss/validate'

function guiaComEquipe(overrides: Partial<SpSadtGuiaModel> = {}): SpSadtGuiaModel {
  return {
    registroANS: '123456',
    numeroGuiaPrestador: 'G-EQUIPE-1',
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
        descricao: 'Cirurgia exemplo',
        quantidade: 1,
        valorUnitarioCents: 350000,
        valorTotalCents: 350000,
        equipe: [
          {
            grauParticipacao: '00',
            cpfContratado: '11144477735',
            nome: 'Dr. Cirurgião',
            conselho: '06',
            numeroConselho: '111111',
            uf: '35',
            cbo: '225125',
          },
          {
            grauParticipacao: '06',
            cpfContratado: '52998224725',
            nome: 'Dr. Anestesista',
            conselho: '06',
            numeroConselho: '222222',
            uf: '35',
            cbo: '225151',
          },
        ],
      },
    ],
    ...overrides,
  }
}

function lote(guias: SpSadtGuiaModel[]): SpSadtLoteModel {
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

describe('TISS — render SP/SADT com equipeSadt valida no XSD 04.03.00', () => {
  it('procedimento com 2 membros de equipe → mensagemTISS válida', async () => {
    const xml = renderSpSadtLoteXml(lote([guiaComEquipe()]))
    expect(xml).toContain('<equipeSadt>')
    expect(xml).toContain('<grauPart>00</grauPart>')
    expect(xml).toContain('<cpfContratado>')
    const result = await validateTissXml(xml)
    expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)
  })

  it('membro sem grauPart (opcional) → ainda válida', async () => {
    const xml = renderSpSadtLoteXml(
      lote([
        guiaComEquipe({
          procedimentos: [
            {
              sequencial: 1,
              dataExecucao: '2026-06-09',
              codigoTabela: '22',
              codigoProcedimento: '40304361',
              descricao: 'Cirurgia exemplo',
              quantidade: 1,
              valorUnitarioCents: 350000,
              valorTotalCents: 350000,
              equipe: [
                {
                  cpfContratado: '11144477735',
                  nome: 'Dr. Primeiro Auxiliar',
                  conselho: '06',
                  numeroConselho: '333333',
                  uf: '35',
                  cbo: '225125',
                },
              ],
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

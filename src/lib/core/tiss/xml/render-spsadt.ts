/**
 * Feature 029 (US3/T046) — renderização do XML da Guia de SP/SADT (execução)
 * TISS 04.03.00 (`ctm_sp-sadtGuia`).
 *
 * Diferente da Consulta, a SP/SADT tem blocos `dadosSolicitante` e
 * `dadosExecutante` separados e uma lista `procedimentosExecutados` com N
 * linhas (cada uma com Via/Técnica opcionais, `reducaoAcrescimo` obrigatório
 * e valores), além do bloco `valorTotal`. A ordem dos elementos segue
 * EXATAMENTE a sequência do XSD — o validador xmllint/XSD é o gate.
 *
 * Como a clínica é solicitante E executante do procedimento, os dois blocos
 * usam o mesmo contratado/profissional (D: clínica fatura como PJ).
 */
import { create } from 'xmlbuilder2'
import { TISS_NAMESPACE } from '../version'
import { centsToDecimal, TISS_PADRAO_VERSAO, type ProfissionalExecutante } from './render-consulta'

export interface SpSadtProcedimento {
  /** Sequencial da linha (1..N). */
  sequencial: number
  /** Data de execução (YYYY-MM-DD). */
  dataExecucao: string
  /** Código de tabela TISS (dom. 87). */
  codigoTabela: string
  /** Código do procedimento na tabela. */
  codigoProcedimento: string
  /** Descrição do procedimento (st_texto150, obrigatório no XSD). */
  descricao: string
  /** Quantidade executada (st_numerico3 — inteiro). */
  quantidade: number
  /** `dm_viaDeAcesso` (dom. 63), opcional. */
  viaAcesso?: string | null
  /** `dm_tecnicaUtilizada` (dom. 48), opcional. */
  tecnicaUtilizada?: string | null
  /** Fator de redução/acréscimo (st_decimal3-2). Sem redução = 1.00. */
  fatorReducaoAcrescimo?: string
  valorUnitarioCents: number
  valorTotalCents: number
}

export interface SpSadtGuiaModel {
  registroANS: string
  numeroGuiaPrestador: string
  numeroGuiaOperadora?: string | null
  beneficiario: {
    numeroCarteira: string
    atendimentoRN: 'S' | 'N'
  }
  /** Contratado (mesmo código na operadora p/ solicitante e executante). */
  codigoPrestadorNaOperadora: string
  /** Nome do contratado solicitante (st_texto70). */
  nomeContratado: string
  /** CNES do executante ('9999999' se não houver). */
  cnes: string
  profissional: ProfissionalExecutante
  /** `dm_caraterAtendimento` (dom. 23): '1' eletivo, '2' urgência. */
  caraterAtendimento: string
  /** `dm_tipoAtendimento` (dom. 50). */
  tipoAtendimento: string
  /** `dm_indicadorAcidente` (dom. 36). */
  indicacaoAcidente: string
  /** `dm_regimeAtendimento` (dom. 76). */
  regimeAtendimento: string
  /** `dm_tipoConsulta` (dom. 52), opcional na SP/SADT. */
  tipoConsulta?: string | null
  procedimentos: SpSadtProcedimento[]
}

export interface SpSadtLoteModel {
  sequencialTransacao: string
  dataRegistro: string
  horaRegistro: string
  origemCnpj: string
  destinoRegistroANS: string
  numeroLote: string
  guias: SpSadtGuiaModel[]
  hash?: string
}

/** st_decimal3-2 — fator com 2 casas, ponto separador (ex.: "1.00"). */
function fator(value: string | undefined): string {
  if (!value) return '1.00'
  const n = Number(value.replace(',', '.'))
  return Number.isFinite(n) ? n.toFixed(2) : '1.00'
}

/** Monta a `guiaSP-SADT` na ordem exata da `ctm_sp-sadtGuia`. */
function buildGuiaSpSadt(g: SpSadtGuiaModel): Record<string, unknown> {
  const profissional = (): Record<string, unknown> => {
    const prof: Record<string, unknown> = {}
    if (g.profissional.nome) prof.nomeProfissional = g.profissional.nome
    prof.conselhoProfissional = g.profissional.conselho
    prof.numeroConselhoProfissional = g.profissional.numeroConselho
    prof.UF = g.profissional.uf
    prof.CBOS = g.profissional.cbo
    return prof
  }

  const guia: Record<string, unknown> = {
    cabecalhoGuia: {
      registroANS: g.registroANS,
      numeroGuiaPrestador: g.numeroGuiaPrestador,
    },
    dadosBeneficiario: {
      numeroCarteira: g.beneficiario.numeroCarteira,
      atendimentoRN: g.beneficiario.atendimentoRN,
    },
    dadosSolicitante: {
      contratadoSolicitante: {
        codigoPrestadorNaOperadora: g.codigoPrestadorNaOperadora,
      },
      nomeContratadoSolicitante: g.nomeContratado,
      profissionalSolicitante: profissional(),
    },
    dadosSolicitacao: {
      caraterAtendimento: g.caraterAtendimento,
    },
    dadosExecutante: {
      contratadoExecutante: {
        codigoPrestadorNaOperadora: g.codigoPrestadorNaOperadora,
      },
      CNES: g.cnes,
    },
    dadosAtendimento: buildAtendimento(g),
    procedimentosExecutados: {
      procedimentoExecutado: g.procedimentos.map((p) => buildLinha(p)),
    },
    valorTotal: {
      valorProcedimentos: centsToDecimal(
        g.procedimentos.reduce((s, p) => s + p.valorTotalCents, 0),
      ),
      valorTotalGeral: centsToDecimal(
        g.procedimentos.reduce((s, p) => s + p.valorTotalCents, 0),
      ),
    },
  }
  if (g.numeroGuiaOperadora) {
    // numeroGuiaOperadora não existe na SP/SADT exec; mantido fora do XSD.
    delete guia.numeroGuiaOperadora
  }
  return guia
}

function buildAtendimento(g: SpSadtGuiaModel): Record<string, unknown> {
  const at: Record<string, unknown> = {
    tipoAtendimento: g.tipoAtendimento,
    indicacaoAcidente: g.indicacaoAcidente,
  }
  if (g.tipoConsulta) at.tipoConsulta = g.tipoConsulta
  at.regimeAtendimento = g.regimeAtendimento
  return at
}

function buildLinha(p: SpSadtProcedimento): Record<string, unknown> {
  const linha: Record<string, unknown> = {
    sequencialItem: String(p.sequencial),
    dataExecucao: p.dataExecucao,
    procedimento: {
      codigoTabela: p.codigoTabela,
      codigoProcedimento: p.codigoProcedimento,
      descricaoProcedimento: p.descricao,
    },
    quantidadeExecutada: String(p.quantidade),
  }
  if (p.viaAcesso) linha.viaAcesso = p.viaAcesso
  if (p.tecnicaUtilizada) linha.tecnicaUtilizada = p.tecnicaUtilizada
  linha.reducaoAcrescimo = fator(p.fatorReducaoAcrescimo)
  linha.valorUnitario = centsToDecimal(p.valorUnitarioCents)
  linha.valorTotal = centsToDecimal(p.valorTotalCents)
  return linha
}

/**
 * Renderiza a `mensagemTISS` de um lote de guias SP/SADT como string XML.
 * Deve validar contra os XSDs 04.03.00 via `validateTissXml`.
 */
export function renderSpSadtLoteXml(model: SpSadtLoteModel): string {
  const doc = {
    mensagemTISS: {
      '@xmlns': TISS_NAMESPACE,
      cabecalho: {
        identificacaoTransacao: {
          tipoTransacao: 'ENVIO_LOTE_GUIAS',
          sequencialTransacao: model.sequencialTransacao,
          dataRegistroTransacao: model.dataRegistro,
          horaRegistroTransacao: model.horaRegistro,
        },
        origem: {
          identificacaoPrestador: { CNPJ: model.origemCnpj },
        },
        destino: {
          registroANS: model.destinoRegistroANS,
        },
        Padrao: TISS_PADRAO_VERSAO,
      },
      prestadorParaOperadora: {
        loteGuias: {
          numeroLote: model.numeroLote,
          guiasTISS: {
            'guiaSP-SADT': model.guias.map(buildGuiaSpSadt),
          },
        },
      },
      epilogo: {
        hash: model.hash ?? '',
      },
    },
  }
  return create({ version: '1.0', encoding: 'UTF-8' }, doc).end({ prettyPrint: false })
}

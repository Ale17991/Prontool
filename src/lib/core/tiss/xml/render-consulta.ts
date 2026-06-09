/**
 * Feature 029 (US2/T029) — renderização do XML da Guia de Consulta TISS 04.03.00.
 *
 * Produz uma `mensagemTISS` completa (cabeçalho + `prestadorParaOperadora`/
 * `loteGuias` + epílogo) contendo uma ou mais `guiaConsulta`. A ordem dos
 * elementos segue EXATAMENTE a sequência dos XSDs oficiais (`ctm_consultaGuia`,
 * `cabecalhoTransacao`, `ctm_guiaLote`) — o validador `validate.ts` (xmllint/XSD)
 * é o gate que garante conformidade.
 *
 * O modelo já chega com CÓDIGOS de domínio resolvidos (conselho 26, UF 59 IBGE,
 * CBO 24, tabela 87) — o mapeamento sigla→código acontece em `build-guia.ts`.
 *
 * NB: o valor de `Padrao` (`dm_versao`) é "4.03.00" — SEM zero à esquerda —
 * diferente da constante interna `TISS_VERSION` ("04.03.00").
 */
import { create } from 'xmlbuilder2'
import { TISS_NAMESPACE } from '../version'

/** Valor de `dm_versao` no cabeçalho (ANS não usa zero à esquerda no major). */
export const TISS_PADRAO_VERSAO = '4.03.00' as const

export interface ConsultaProcedimento {
  /** Código de tabela TISS (dom. 87/`dm_tabela`): '22','18','19','20','00'... */
  codigoTabela: string
  /** Código do procedimento na tabela. */
  codigoProcedimento: string
  /** Valor do procedimento em centavos (convertido para decimal 10-2 no XML). */
  valorCents: number
}

export interface ProfissionalExecutante {
  /** Nome do profissional (obrigatório quando o contratado é PJ). */
  nome?: string | null
  /** Código `dm_conselhoProfissional` (dom. 26), ex.: '06' = CRM. */
  conselho: string
  /** Número de inscrição no conselho. */
  numeroConselho: string
  /** Código IBGE da UF (`dm_UF`, dom. 59), ex.: '35' = SP. */
  uf: string
  /** Código CBO (`dm_CBOS`, dom. 24), 6 dígitos. */
  cbo: string
}

export interface ConsultaGuiaModel {
  /** Registro ANS da operadora (6 dígitos). */
  registroANS: string
  /** Nº da guia no prestador (sequencial por tenant). */
  numeroGuiaPrestador: string
  /** Nº da guia atribuído pela operadora (condicional). */
  numeroGuiaOperadora?: string | null
  beneficiario: {
    numeroCarteira: string
    /** Atendimento a recém-nascido (`dm_simNao`). */
    atendimentoRN: 'S' | 'N'
  }
  contratadoExecutante: {
    /** Código do prestador na operadora (contracted_code). */
    codigoPrestadorNaOperadora: string
    /** CNES do estabelecimento ('9999999' se não houver). */
    cnes: string
  }
  profissionalExecutante: ProfissionalExecutante
  /** `dm_indicadorAcidente` (dom. 36): '0','1','2','9'. */
  indicacaoAcidente: string
  atendimento: {
    /** `dm_regimeAtendimento` (dom. 76): '01'..'05'. */
    regimeAtendimento: string
    /** Data do atendimento, formato `date` (YYYY-MM-DD). */
    dataAtendimento: string
    /** `dm_tipoConsulta` (dom. 52): '1'..'4'. */
    tipoConsulta: string
    procedimento: ConsultaProcedimento
  }
}

export interface LoteMensagemModel {
  /** Sequencial da transação (`st_texto12`). */
  sequencialTransacao: string
  /** Data de registro da transação, formato `date`. */
  dataRegistro: string
  /** Hora de registro da transação, formato `time` (HH:MM:SS). */
  horaRegistro: string
  /** CNPJ do prestador (origem). */
  origemCnpj: string
  /** Registro ANS de destino (operadora). */
  destinoRegistroANS: string
  /** Número do lote (`st_texto12`). */
  numeroLote: string
  /** Guias de consulta do lote. */
  guias: ConsultaGuiaModel[]
  /** Hash MD-5 do epílogo (US4); placeholder vazio na fase US2. */
  hash?: string
}

/** Centavos → string decimal com 2 casas (`st_decimal10-2`), ponto como separador. */
export function centsToDecimal(cents: number): string {
  return (cents / 100).toFixed(2)
}

/** Monta o objeto da `guiaConsulta` na ordem exata da `ctm_consultaGuia`. */
function buildGuiaConsulta(g: ConsultaGuiaModel): Record<string, unknown> {
  const guia: Record<string, unknown> = {
    cabecalhoConsulta: {
      registroANS: g.registroANS,
      numeroGuiaPrestador: g.numeroGuiaPrestador,
    },
  }
  if (g.numeroGuiaOperadora) {
    guia.numeroGuiaOperadora = g.numeroGuiaOperadora
  }
  guia.dadosBeneficiario = {
    numeroCarteira: g.beneficiario.numeroCarteira,
    atendimentoRN: g.beneficiario.atendimentoRN,
  }
  guia.contratadoExecutante = {
    codigoPrestadorNaOperadora: g.contratadoExecutante.codigoPrestadorNaOperadora,
    CNES: g.contratadoExecutante.cnes,
  }
  const prof: Record<string, unknown> = {}
  if (g.profissionalExecutante.nome) prof.nomeProfissional = g.profissionalExecutante.nome
  prof.conselhoProfissional = g.profissionalExecutante.conselho
  prof.numeroConselhoProfissional = g.profissionalExecutante.numeroConselho
  prof.UF = g.profissionalExecutante.uf
  prof.CBOS = g.profissionalExecutante.cbo
  guia.profissionalExecutante = prof
  guia.indicacaoAcidente = g.indicacaoAcidente
  guia.dadosAtendimento = {
    regimeAtendimento: g.atendimento.regimeAtendimento,
    dataAtendimento: g.atendimento.dataAtendimento,
    tipoConsulta: g.atendimento.tipoConsulta,
    procedimento: {
      codigoTabela: g.atendimento.procedimento.codigoTabela,
      codigoProcedimento: g.atendimento.procedimento.codigoProcedimento,
      valorProcedimento: centsToDecimal(g.atendimento.procedimento.valorCents),
    },
  }
  return guia
}

/**
 * Renderiza a `mensagemTISS` completa do lote de guias de consulta como string XML.
 * O resultado deve validar contra os XSDs 04.03.00 via `validateTissXml`.
 */
export function renderConsultaLoteXml(model: LoteMensagemModel): string {
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
            guiaConsulta: model.guias.map(buildGuiaConsulta),
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

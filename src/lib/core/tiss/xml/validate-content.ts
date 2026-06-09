/**
 * Feature 029 (US2/T028) — validação de CONTEÚDO da Guia de Consulta.
 *
 * Roda ANTES de renderizar/validar no XSD: confere as obrigatoriedades da
 * legenda 202511 sobre um rascunho montado de dados do sistema (que pode ter
 * lacunas: carteira faltando, CBO não cadastrado, conselho/UF não mapeáveis).
 * Devolve `validation_errors[]` legíveis — espelha o bloqueio de "Prescrever"
 * da Memed: a guia só vira `pronta` quando a lista volta vazia.
 *
 * Validações de domínio usam as pequenas enumerações fixas do XSD (regime,
 * tipo de consulta, indicação de acidente, tabela). Vigência do código TUSS
 * é responsabilidade do trigger de coerência + `build-guia` (flag `tussVigente`).
 */

export interface ValidationError {
  field: string
  message: string
}

export interface DraftProcedimento {
  tabela: string | null
  codigo: string | null
  valorCents: number | null
  /** false quando o código TUSS está fora de vigência (sinalizado por build-guia). */
  tussVigente: boolean
}

export interface GuiaConsultaDraft {
  registroANS: string | null
  numeroGuiaPrestador: string | null
  numeroCarteira: string | null
  atendimentoRN: 'S' | 'N'
  contractedCode: string | null
  cnes: string | null
  /** Executante PJ exige nome do profissional. */
  contratadoIsPJ: boolean
  profissional: {
    nome: string | null
    /** Código dom. 26 já resolvido (null = sigla não mapeável). */
    conselhoCodigo: string | null
    /** Sigla original do conselho (para mensagem de erro). */
    conselhoRaw: string | null
    numeroConselho: string | null
    /** Código IBGE dom. 59 já resolvido (null = UF não mapeável). */
    ufCodigo: string | null
    ufRaw: string | null
    cbo: string | null
  }
  indicacaoAcidente: string | null
  regimeAtendimento: string | null
  dataAtendimento: string | null
  tipoConsulta: string | null
  procedimentos: DraftProcedimento[]
}

const REGIME_VALIDOS = new Set(['01', '02', '03', '04', '05'])
const TIPO_CONSULTA_VALIDOS = new Set(['1', '2', '3', '4'])
const INDICACAO_ACIDENTE_VALIDOS = new Set(['0', '1', '2', '9'])
const TABELA_VALIDOS = new Set(['18', '19', '20', '22', '90', '98', '00'])

function presente(v: string | null | undefined): boolean {
  return typeof v === 'string' && v.trim().length > 0
}

/**
 * Valida o conteúdo de um rascunho de Guia de Consulta. Lista vazia = pronta.
 */
export function validateConsultaContent(draft: GuiaConsultaDraft): ValidationError[] {
  const errors: ValidationError[] = []
  const add = (field: string, message: string) => errors.push({ field, message })

  if (!presente(draft.registroANS) || !/^\d{6}$/.test(draft.registroANS!.trim())) {
    add('registroANS', 'Registro ANS da operadora ausente ou inválido (6 dígitos).')
  }
  if (!presente(draft.numeroGuiaPrestador)) {
    add('numeroGuiaPrestador', 'Número da guia no prestador é obrigatório.')
  }
  if (!presente(draft.numeroCarteira)) {
    add('numeroCarteira', 'Número da carteira do beneficiário é obrigatório (cadastre a carteira da operadora).')
  }
  if (!presente(draft.contractedCode)) {
    add('contratadoExecutante', 'Código do contratado na operadora é obrigatório (configuração TISS).')
  }
  if (!presente(draft.cnes)) {
    add('CNES', "CNES é obrigatório (use '9999999' se não houver).")
  }

  // Profissional executante.
  const p = draft.profissional
  if (draft.contratadoIsPJ && !presente(p.nome)) {
    add('profissionalExecutante.nome', 'Nome do profissional é obrigatório quando o contratado é pessoa jurídica.')
  }
  if (!presente(p.conselhoCodigo)) {
    add(
      'profissionalExecutante.conselho',
      p.conselhoRaw
        ? `Conselho profissional "${p.conselhoRaw}" não mapeado para o domínio TISS 26.`
        : 'Conselho profissional do executante é obrigatório.',
    )
  }
  if (!presente(p.numeroConselho)) {
    add('profissionalExecutante.numeroConselho', 'Número de inscrição no conselho é obrigatório.')
  }
  if (!presente(p.ufCodigo)) {
    add(
      'profissionalExecutante.UF',
      p.ufRaw
        ? `UF do conselho "${p.ufRaw}" não reconhecida (domínio TISS 59).`
        : 'UF do conselho é obrigatória.',
    )
  }
  if (!presente(p.cbo)) {
    add('profissionalExecutante.CBOS', 'CBO do profissional é obrigatório (cadastre o CBO do médico).')
  } else if (!/^\d{6}$/.test(p.cbo!.trim())) {
    add('profissionalExecutante.CBOS', 'CBO deve ter 6 dígitos (domínio TISS 24).')
  }

  // Domínios de atendimento.
  if (!presente(draft.indicacaoAcidente) || !INDICACAO_ACIDENTE_VALIDOS.has(draft.indicacaoAcidente!)) {
    add('indicacaoAcidente', 'Indicação de acidente inválida (domínio 36: 0, 1, 2 ou 9).')
  }
  if (!presente(draft.regimeAtendimento) || !REGIME_VALIDOS.has(draft.regimeAtendimento!)) {
    add('regimeAtendimento', 'Regime de atendimento inválido (domínio 76: 01 a 05).')
  }
  if (!presente(draft.dataAtendimento)) {
    add('dataAtendimento', 'Data do atendimento é obrigatória.')
  }
  if (!presente(draft.tipoConsulta) || !TIPO_CONSULTA_VALIDOS.has(draft.tipoConsulta!)) {
    add('tipoConsulta', 'Tipo de consulta inválido (domínio 52: 1 a 4).')
  }

  // Procedimento(s): toda guia de consulta tem ao menos um.
  if (draft.procedimentos.length === 0) {
    add('procedimento', 'A guia precisa de ao menos um procedimento.')
  }
  draft.procedimentos.forEach((proc, i) => {
    const at = `procedimento[${i}]`
    if (!presente(proc.tabela) || !TABELA_VALIDOS.has(proc.tabela!)) {
      add(`${at}.codigoTabela`, 'Código de tabela inválido (domínio 87).')
    }
    if (!presente(proc.codigo)) {
      add(`${at}.codigoProcedimento`, 'Código do procedimento é obrigatório (nunca texto livre).')
    }
    if (proc.valorCents === null || proc.valorCents < 0) {
      add(`${at}.valorProcedimento`, 'Valor do procedimento inválido.')
    }
    if (!proc.tussVigente) {
      add(`${at}.codigoProcedimento`, 'Código TUSS fora da vigência do catálogo atual.')
    }
  })

  return errors
}

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

/**
 * Feature 031 — membro da equipe (participante) de uma linha de procedimento,
 * já com domínios resolvidos (conselho 26, UF 59). Para a guia ficar `pronta`,
 * todos os campos exigidos pelo XSD ct_identEquipeSADT precisam estar completos.
 */
export interface DraftEquipeMembro {
  /** dm_grauPart (dom. 35) — opcional no XSD. */
  grauParticipacao: string | null
  cpf: string | null
  nome: string | null
  conselhoCodigo: string | null
  conselhoRaw: string | null
  numeroConselho: string | null
  ufCodigo: string | null
  ufRaw: string | null
  cbo: string | null
}

export interface DraftProcedimento {
  tabela: string | null
  codigo: string | null
  valorCents: number | null
  /** false quando o código TUSS está fora de vigência (sinalizado por build-guia). */
  tussVigente: boolean
  /** Feature 031 — participantes da linha (0..N). */
  equipe?: DraftEquipeMembro[]
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
// dm_caraterAtendimento (dom. 23): 1 eletivo, 2 urgência/emergência.
const CARATER_VALIDOS = new Set(['1', '2'])
// dm_tipoAtendimento (dom. 50) — subconjunto enumerado no XSD 04.03.00.
const TIPO_ATENDIMENTO_VALIDOS = new Set([
  '01',
  '02',
  '03',
  '04',
  '08',
  '09',
  '10',
  '13',
  '23',
])

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
    validateEquipe(proc.equipe, at, add)
  })

  return errors
}

/**
 * Feature 031 — valida a equipe de uma linha de procedimento. Cada membro
 * precisa de CPF, nome, conselho (mapeado), número, UF (mapeada) e CBO para a
 * guia ficar `pronta` (espelha as obrigatoriedades de ct_identEquipeSADT).
 */
function validateEquipe(
  equipe: DraftEquipeMembro[] | undefined,
  at: string,
  add: (field: string, message: string) => void,
): void {
  if (!equipe || equipe.length === 0) return
  equipe.forEach((m, j) => {
    const mat = `${at}.equipe[${j}]`
    if (!presente(m.cpf) || !/^\d{11}$/.test(m.cpf!.trim())) {
      add(`${mat}.cpfContratado`, `Participante ${m.nome ?? j + 1}: CPF ausente ou inválido (11 dígitos).`)
    }
    if (!presente(m.nome)) {
      add(`${mat}.nomeProf`, 'Nome do participante é obrigatório.')
    }
    if (!presente(m.conselhoCodigo)) {
      add(
        `${mat}.conselho`,
        m.conselhoRaw
          ? `Conselho "${m.conselhoRaw}" do participante não mapeado (domínio TISS 26).`
          : 'Conselho do participante é obrigatório.',
      )
    }
    if (!presente(m.numeroConselho)) {
      add(`${mat}.numeroConselhoProfissional`, 'Número de inscrição no conselho do participante é obrigatório.')
    }
    if (!presente(m.ufCodigo)) {
      add(
        `${mat}.UF`,
        m.ufRaw ? `UF "${m.ufRaw}" do participante não reconhecida (domínio TISS 59).` : 'UF do participante é obrigatória.',
      )
    }
    if (!presente(m.cbo)) {
      add(`${mat}.CBOS`, 'CBO do participante é obrigatório (domínio TISS 24).')
    } else if (!/^\d{6}$/.test(m.cbo!.trim())) {
      add(`${mat}.CBOS`, 'CBO do participante deve ter 6 dígitos (domínio TISS 24).')
    }
  })
}

export interface GuiaSpSadtDraft {
  registroANS: string | null
  numeroGuiaPrestador: string | null
  numeroCarteira: string | null
  atendimentoRN: 'S' | 'N'
  contractedCode: string | null
  /** Nome do contratado (st_texto70) — obrigatório no bloco solicitante. */
  nomeContratado: string | null
  cnes: string | null
  contratadoIsPJ: boolean
  profissional: GuiaConsultaDraft['profissional']
  indicacaoAcidente: string | null
  regimeAtendimento: string | null
  /** dm_caraterAtendimento (dom. 23). */
  caraterAtendimento: string | null
  /** dm_tipoAtendimento (dom. 50). */
  tipoAtendimento: string | null
  procedimentos: DraftProcedimento[]
}

/**
 * Valida o conteúdo de um rascunho de Guia de SP/SADT (execução). Reaproveita
 * as obrigatoriedades compartilhadas da Consulta e acrescenta as específicas
 * da SP/SADT (caráter, tipo de atendimento, nome do contratado, N linhas).
 */
export function validateSpSadtContent(draft: GuiaSpSadtDraft): ValidationError[] {
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
    add('contratado', 'Código do contratado na operadora é obrigatório (configuração TISS).')
  }
  if (!presente(draft.nomeContratado)) {
    add('nomeContratadoSolicitante', 'Nome do contratado é obrigatório (preencha a razão social da clínica nas configurações).')
  }
  if (!presente(draft.cnes)) {
    add('CNES', "CNES é obrigatório (use '9999999' se não houver).")
  }

  const p = draft.profissional
  if (draft.contratadoIsPJ && !presente(p.nome)) {
    add('profissionalSolicitante.nome', 'Nome do profissional é obrigatório quando o contratado é pessoa jurídica.')
  }
  if (!presente(p.conselhoCodigo)) {
    add(
      'profissionalSolicitante.conselho',
      p.conselhoRaw
        ? `Conselho profissional "${p.conselhoRaw}" não mapeado para o domínio TISS 26.`
        : 'Conselho profissional é obrigatório.',
    )
  }
  if (!presente(p.numeroConselho)) {
    add('profissionalSolicitante.numeroConselho', 'Número de inscrição no conselho é obrigatório.')
  }
  if (!presente(p.ufCodigo)) {
    add(
      'profissionalSolicitante.UF',
      p.ufRaw ? `UF do conselho "${p.ufRaw}" não reconhecida (domínio TISS 59).` : 'UF do conselho é obrigatória.',
    )
  }
  if (!presente(p.cbo)) {
    add('profissionalSolicitante.CBOS', 'CBO do profissional é obrigatório (cadastre o CBO do médico).')
  } else if (!/^\d{6}$/.test(p.cbo!.trim())) {
    add('profissionalSolicitante.CBOS', 'CBO deve ter 6 dígitos (domínio TISS 24).')
  }

  if (!presente(draft.caraterAtendimento) || !CARATER_VALIDOS.has(draft.caraterAtendimento!)) {
    add('caraterAtendimento', 'Caráter do atendimento inválido (domínio 23: 1 eletivo ou 2 urgência).')
  }
  if (!presente(draft.tipoAtendimento) || !TIPO_ATENDIMENTO_VALIDOS.has(draft.tipoAtendimento!)) {
    add('tipoAtendimento', 'Tipo de atendimento inválido (domínio 50).')
  }
  if (!presente(draft.indicacaoAcidente) || !INDICACAO_ACIDENTE_VALIDOS.has(draft.indicacaoAcidente!)) {
    add('indicacaoAcidente', 'Indicação de acidente inválida (domínio 36: 0, 1, 2 ou 9).')
  }
  if (!presente(draft.regimeAtendimento) || !REGIME_VALIDOS.has(draft.regimeAtendimento!)) {
    add('regimeAtendimento', 'Regime de atendimento inválido (domínio 76: 01 a 05).')
  }

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
    validateEquipe(proc.equipe, at, add)
  })

  return errors
}

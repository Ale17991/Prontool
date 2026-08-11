/**
 * Quais dados do paciente aparecem nos impressos (migration 0195).
 *
 * O catálogo é CÓDIGO, não tabela, pelo mesmo motivo dos números da norma em
 * `labeling/reference.ts`: é uma enumeração fechada que clínica nenhuma inventa.
 * Cada chave aqui tem um leitor correspondente em `patient-identity.ts` — uma
 * chave que a clínica pudesse cadastrar sozinha não teria de onde tirar valor.
 *
 * A ORDEM DESTA LISTA É A ORDEM IMPRESSA. Não é a ordem em que a clínica marcou
 * as caixas, nem a ordem gravada no banco: dois documentos da mesma clínica
 * precisam ler igual, e uma ordem que depende de como alguém clicou produz
 * papéis diferentes sem que ninguém tenha pedido.
 *
 * O NOME NÃO ESTÁ AQUI. É piso, não opção — ver o comentário da 0195.
 */

export type PrintoutPatientField =
  | 'nome_social'
  | 'nascimento'
  | 'idade'
  | 'sexo'
  | 'cpf'
  | 'rg'
  | 'telefone'
  | 'email'
  | 'convenio'
  | 'carteirinha'
  | 'endereco'
  | 'nome_mae'
  | 'responsavel'

export interface PrintoutFieldSpec {
  key: PrintoutPatientField
  /** Rótulo impresso no documento. */
  label: string
  /** Explicação na tela de configuração, quando o rótulo não basta. */
  hint?: string
  /**
   * Dado que, impresso, aumenta materialmente a exposição do paciente. A tela
   * sinaliza; não bloqueia. A clínica tem motivos legítimos (farmácia pede CPF
   * no receituário), mas a escolha deve ser consciente.
   */
  sensitive?: boolean
}

export const PRINTOUT_PATIENT_FIELDS: readonly PrintoutFieldSpec[] = [
  {
    key: 'nome_social',
    label: 'Nome social',
    hint: 'Aparece junto do nome civil quando cadastrado.',
  },
  { key: 'nascimento', label: 'Nascimento' },
  { key: 'idade', label: 'Idade' },
  { key: 'sexo', label: 'Sexo' },
  { key: 'cpf', label: 'CPF', sensitive: true },
  { key: 'rg', label: 'RG', sensitive: true },
  { key: 'telefone', label: 'Telefone', sensitive: true },
  { key: 'email', label: 'E-mail', sensitive: true },
  { key: 'convenio', label: 'Convênio' },
  { key: 'carteirinha', label: 'Carteirinha', sensitive: true },
  { key: 'endereco', label: 'Endereço', sensitive: true },
  { key: 'nome_mae', label: 'Nome da mãe', sensitive: true },
  {
    key: 'responsavel',
    label: 'Responsável',
    hint: 'Nome e grau de parentesco. Útil em pediatria.',
  },
] as const

const FIELD_KEYS = new Set<string>(PRINTOUT_PATIENT_FIELDS.map((f) => f.key))

/**
 * Documentos que aceitam configuração.
 *
 * Os sete primeiros ids repetem os nomes que `auditPrintout` já grava na trilha
 * de auditoria (054) — mesma coisa, mesmo nome, para a configuração e o log
 * falarem do mesmo documento.
 *
 * DUAS AUSÊNCIAS DELIBERADAS
 *
 * A **guia TISS** (029): o conteúdo dela é mandatório pela ANS, e deixar a
 * clínica escolher o que a norma obriga a mandar troca um documento válido por
 * uma glosa.
 *
 * O **prontuário completo**: lá os dados do paciente são a seção 1 do
 * documento, não um cabeçalho de identificação — é conteúdo, e conteúdo com
 * rótulo próprio, em duas colunas. Um "prontuário completo" que esconde CPF ou
 * endereço deixa de ser completo, e é justamente a completude que faz dele o
 * documento aceito para portabilidade e para segunda opinião. Oferecer o
 * ajuste ali seria oferecer uma opção que ninguém deveria marcar.
 */
export type PrintoutDocumentId =
  | 'anamnese'
  | 'avaliacao-nutricional'
  | 'crescimento'
  | 'exames'
  | 'orientacoes'
  | 'plano-alimentar'
  | 'recordatorio'
  | 'pedido-exame'
  | 'receita-oculos'
  | 'orcamento-odonto'
  | 'laudo-oftalmo'
  | 'documento'

export interface PrintoutDocumentSpec {
  id: PrintoutDocumentId
  label: string
  /** Agrupamento na tela de configuração. */
  area: 'geral' | 'nutricao' | 'odonto' | 'oftalmo'
}

export const PRINTOUT_DOCUMENTS: readonly PrintoutDocumentSpec[] = [
  { id: 'anamnese', label: 'Anamnese', area: 'geral' },
  { id: 'pedido-exame', label: 'Pedido de exame', area: 'geral' },
  { id: 'documento', label: 'Documento do paciente', area: 'geral' },
  { id: 'orientacoes', label: 'Orientações', area: 'nutricao' },
  { id: 'avaliacao-nutricional', label: 'Avaliação nutricional', area: 'nutricao' },
  { id: 'plano-alimentar', label: 'Plano alimentar', area: 'nutricao' },
  { id: 'recordatorio', label: 'Recordatório alimentar', area: 'nutricao' },
  { id: 'exames', label: 'Exames laboratoriais', area: 'nutricao' },
  { id: 'crescimento', label: 'Curva de crescimento', area: 'nutricao' },
  { id: 'orcamento-odonto', label: 'Orçamento odontológico', area: 'odonto' },
  { id: 'receita-oculos', label: 'Receita de óculos', area: 'oftalmo' },
  { id: 'laudo-oftalmo', label: 'Laudo oftalmológico', area: 'oftalmo' },
] as const

/** O que a 054 já imprimia, menos o sexo. Espelha o DEFAULT da coluna na 0195. */
export const DEFAULT_PRINTOUT_FIELDS: readonly PrintoutPatientField[] = ['nascimento', 'idade']

export interface PrintoutFieldConfig {
  /** Padrão da clínica. */
  fields: readonly string[]
  /** Conjunto COMPLETO por documento — não acréscimo. Ver comentário da 0195. */
  overrides: Readonly<Record<string, readonly string[]>>
}

/**
 * Conjunto efetivo de um documento: a exceção dele, se existir; senão o padrão.
 *
 * Filtra chave desconhecida em vez de recusar. O array vem do banco e pode
 * carregar uma chave de uma versão futura ou já removida; recusar tudo deixaria
 * o documento SEM identificação nenhuma, que é pior que ignorar uma linha. A
 * ordem devolvida é sempre a do catálogo.
 */
export function resolvePrintoutFields(
  config: PrintoutFieldConfig | null | undefined,
  documentId: PrintoutDocumentId,
): PrintoutPatientField[] {
  const override = config?.overrides?.[documentId]
  const chosen = override ?? config?.fields ?? DEFAULT_PRINTOUT_FIELDS
  const selected = new Set(chosen.filter((k) => FIELD_KEYS.has(k)))
  return PRINTOUT_PATIENT_FIELDS.filter((f) => selected.has(f.key)).map((f) => f.key)
}

/** `true` quando o documento tem exceção própria (a tela marca "personalizado"). */
export function hasOverride(
  config: PrintoutFieldConfig | null | undefined,
  documentId: PrintoutDocumentId,
): boolean {
  return Array.isArray(config?.overrides?.[documentId])
}

/** Descarta chave desconhecida na entrada da API, preservando a ordem do catálogo. */
export function sanitizeFieldList(raw: unknown): PrintoutPatientField[] {
  if (!Array.isArray(raw)) return []
  const selected = new Set(raw.filter((k): k is string => typeof k === 'string'))
  return PRINTOUT_PATIENT_FIELDS.filter((f) => selected.has(f.key)).map((f) => f.key)
}

export function isPrintoutDocumentId(v: unknown): v is PrintoutDocumentId {
  return typeof v === 'string' && PRINTOUT_DOCUMENTS.some((d) => d.id === v)
}

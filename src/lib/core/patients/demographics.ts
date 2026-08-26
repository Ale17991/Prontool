/**
 * Estado civil, raça/cor e ocupação do paciente.
 *
 * Módulo puro (sem deps de servidor): a tela desenha o `<Select>` a partir
 * daqui e a rota valida o payload contra a MESMA lista. Duas listas seriam duas
 * verdades, e a que diverge é sempre a que ninguém olha.
 *
 * POR QUE COLUNA EM CLARO, E NÃO `_enc`:
 * A linha que este projeto traça para cifrar é RE-IDENTIFICAÇÃO — nome, CPF,
 * RG, telefone, e-mail, nascimento, endereço, nome da mãe. Estado civil, cor e
 * ocupação não apontam para ninguém sozinhos; só ganham sujeito depois que o
 * nome é decifrado. É o mesmo tratamento que `sex` e `alert_note` já recebem.
 *
 * E há um ganho concreto em manter em claro os dois campos de lista fechada:
 * raça/cor é justamente o recorte que o e-SUS e os relatórios de equidade
 * pedem agregado. Cifrada, a coluna existiria sem poder ser contada — e um
 * dado que não se consegue apurar não cumpre a razão de ter sido coletado.
 */

export type MaritalStatus =
  | 'solteiro'
  | 'casado'
  | 'divorciado'
  | 'viuvo'
  | 'uniao_estavel'
  | 'separado'

/**
 * Categorias do IBGE, que são as mesmas do e-SUS. Não é escolha de estilo:
 * é o vocabulário em que o dado precisa sair quando a clínica reportar.
 */
export type PatientRace = 'branca' | 'preta' | 'parda' | 'amarela' | 'indigena'

export const MARITAL_STATUS_VALUES: readonly MaritalStatus[] = [
  'solteiro',
  'casado',
  'uniao_estavel',
  'divorciado',
  'separado',
  'viuvo',
]

export const PATIENT_RACE_VALUES: readonly PatientRace[] = [
  'branca',
  'preta',
  'parda',
  'amarela',
  'indigena',
]

export const MARITAL_STATUS_LABEL: Record<MaritalStatus, string> = {
  solteiro: 'Solteiro(a)',
  casado: 'Casado(a)',
  uniao_estavel: 'União estável',
  divorciado: 'Divorciado(a)',
  separado: 'Separado(a)',
  viuvo: 'Viúvo(a)',
}

export const PATIENT_RACE_LABEL: Record<PatientRace, string> = {
  branca: 'Branca',
  preta: 'Preta',
  parda: 'Parda',
  amarela: 'Amarela',
  indigena: 'Indígena',
}

/** Ocupação é texto livre — não há lista fechada que sirva a toda clínica. */
export const OCCUPATION_MAX_LENGTH = 120

export function isMaritalStatus(v: unknown): v is MaritalStatus {
  return typeof v === 'string' && (MARITAL_STATUS_VALUES as readonly string[]).includes(v)
}

export function isPatientRace(v: unknown): v is PatientRace {
  return typeof v === 'string' && (PATIENT_RACE_VALUES as readonly string[]).includes(v)
}

export function maritalStatusLabel(v: string | null | undefined): string | null {
  return isMaritalStatus(v) ? MARITAL_STATUS_LABEL[v] : (v ?? null)
}

export function patientRaceLabel(v: string | null | undefined): string | null {
  return isPatientRace(v) ? PATIENT_RACE_LABEL[v] : (v ?? null)
}

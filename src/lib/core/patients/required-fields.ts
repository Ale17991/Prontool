/**
 * Quais dados do paciente são obrigatórios nesta clínica.
 *
 * Duas políticas, e só duas:
 *
 * - **Base** — nome e telefone. São os dados com que a recepção acha o
 *   paciente no balcão e no telefone; sem eles o cadastro não serve para nada.
 *   Todo o resto (CPF, e-mail, nascimento, endereço, plano) é bem-vindo, mas
 *   não segura o cadastro.
 * - **Prescritora Memed** (módulo `memed` ligado no /admin) — acrescenta CPF,
 *   e-mail e data de nascimento, que é o que a Memed exige para emitir
 *   receita (ver `integrations/memed/set-paciente.ts`). Aqui a exigência
 *   antecipa o problema: sem esses campos, a receita falha na hora da
 *   consulta, com o paciente na cadeira.
 *
 * Módulo puro (sem deps de servidor) — roda no cliente para marcar o asterisco
 * no formulário e no servidor para recusar o payload. As duas pontas leem
 * daqui para nunca divergirem.
 *
 * Escopo é a CLÍNICA, não o profissional: o agendamento público "sem
 * preferência" não sabe quem vai atender, então a política precisa ser
 * respondível antes de existir médico escolhido.
 */

export type PatientField = 'full_name' | 'phone' | 'cpf' | 'email' | 'birth_date'

export interface PatientFieldPolicy {
  /** Clínica marcada como prescritora Memed. */
  memedPrescriber: boolean
  /** Campos que seguram o cadastro. Sempre inclui nome e telefone. */
  required: PatientField[]
}

export const PATIENT_FIELD_LABEL: Record<PatientField, string> = {
  full_name: 'nome completo',
  phone: 'telefone',
  cpf: 'CPF',
  email: 'e-mail',
  birth_date: 'data de nascimento',
}

const BASE_REQUIRED: PatientField[] = ['full_name', 'phone']
const MEMED_EXTRA: PatientField[] = ['cpf', 'email', 'birth_date']

export function patientFieldPolicy(memedPrescriber: boolean): PatientFieldPolicy {
  return {
    memedPrescriber,
    required: memedPrescriber ? [...BASE_REQUIRED, ...MEMED_EXTRA] : [...BASE_REQUIRED],
  }
}

export interface PatientFieldValues {
  full_name?: string | null
  phone?: string | null
  cpf?: string | null
  email?: string | null
  birth_date?: string | null
}

function isFilled(field: PatientField, values: PatientFieldValues): boolean {
  switch (field) {
    case 'full_name':
      return (values.full_name ?? '').trim().length >= 2
    case 'phone':
      // 8 dígitos = fixo sem DDD, o piso do que ainda é discável.
      return (values.phone ?? '').replace(/\D/g, '').length >= 8
    case 'cpf':
      return (values.cpf ?? '').replace(/\D/g, '').length === 11
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((values.email ?? '').trim())
    case 'birth_date':
      return /^\d{4}-\d{2}-\d{2}$/.test((values.birth_date ?? '').trim())
  }
}

/** Campos exigidos pela política que estão vazios/inválidos. */
export function missingRequiredPatientFields(
  values: PatientFieldValues,
  policy: PatientFieldPolicy,
): PatientField[] {
  return policy.required.filter((f) => !isFilled(f, values))
}

/**
 * O que falta para PRESCREVER, independente de a clínica ser prescritora.
 *
 * Serve o aviso não-bloqueante em paciente já cadastrado: quem entrou na base
 * antes de a clínica virar prescritora continua atendendo normalmente, só
 * aparece com pendência sinalizada. Ligar o módulo não pode paralisar a
 * recepção — corrige-se paciente a paciente, quando ele volta.
 */
export function missingMemedFields(values: PatientFieldValues): PatientField[] {
  return missingRequiredPatientFields(values, patientFieldPolicy(true))
}

export function describeMissingFields(fields: PatientField[]): string {
  const labels = fields.map((f) => PATIENT_FIELD_LABEL[f])
  if (labels.length <= 1) return labels[0] ?? ''
  return `${labels.slice(0, -1).join(', ')} e ${labels[labels.length - 1]}`
}

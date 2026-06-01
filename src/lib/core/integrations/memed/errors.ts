import { DomainError } from '@/lib/observability/errors'

/**
 * Erros de domínio da integração Memed (Feature 026). Todos estendem
 * `DomainError` para que `toHttpResponse` mapeie o status corretamente.
 */

/** Clínica sem conta Memed conectada (HTTP 424 — dependência ausente). */
export class MemedNotConnectedError extends DomainError {
  constructor() {
    super(
      'MEMED_NOT_CONNECTED',
      'A clínica não está conectada à Memed. Conecte em Configurações → Integrações.',
      { status: 424 },
    )
  }
}

/** Profissional ainda não habilitado como prescritor (HTTP 409). */
export class MemedPrescriberNotRegisteredError extends DomainError {
  constructor() {
    super(
      'MEMED_PRESCRIBER_NOT_REGISTERED',
      'Este profissional ainda não foi habilitado como prescritor na Memed.',
      { status: 409 },
    )
  }
}

/** Cadastro do profissional incompleto para virar prescritor (HTTP 400). */
export class MemedPrescriberFieldsMissingError extends DomainError {
  constructor(missing: string[]) {
    super(
      'MEMED_PRESCRIBER_FIELDS_MISSING',
      `Complete o cadastro do profissional antes de habilitar a prescrição digital. Faltando: ${missing.join(', ')}.`,
      { status: 400, meta: { missing } },
    )
  }
}

/** Paciente sem dados obrigatórios para o setPaciente (HTTP 422). */
export class MemedPatientFieldsMissingError extends DomainError {
  constructor(missing: string[]) {
    super(
      'MEMED_PATIENT_FIELDS_MISSING',
      `Complete o cadastro do paciente antes de prescrever. Faltando: ${missing.join(', ')}.`,
      { status: 422, meta: { missing } },
    )
  }
}

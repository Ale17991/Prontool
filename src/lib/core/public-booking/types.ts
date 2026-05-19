/**
 * Feature 017 — Link público de agendamento online.
 *
 * Tipos canônicos da feature pública. Espelham o schema da migration
 * 0093_public_booking.sql; quando `supabase:gen-types` rodar com
 * Docker ativo, os tipos podem ser cruzados com `Database['public']`
 * existente para garantir consistência.
 */

export type PublicBookingAction = 'cancel' | 'reschedule'

export type RateLimitAction = 'view_slots' | 'submit' | 'cancel'

/**
 * Dia da semana usado em `available_weekdays`: 0=domingo, 6=sábado.
 * Convenção compatível com `EXTRACT(DOW FROM ...)` do Postgres.
 */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

/**
 * Configuração de agendamento público (ALTER em tenant_clinic_profile).
 */
export interface PublicBookingConfig {
  publicBookingSlug: string | null
  publicBookingEnabled: boolean
  publicBookingMinHoursAdvance: number
  publicBookingMaxDaysAdvance: number
  publicBookingCancelMinHours: number
}

/**
 * Médico publicado no link público de uma clínica.
 */
export interface PublishedDoctor {
  tenantId: string
  doctorId: string
  displayOrder: number
  bio: string | null
  availableWeekdays: Weekday[]
  availableFrom: string // 'HH:MM'
  availableUntil: string // 'HH:MM'
  lunchBreakFrom: string | null
  lunchBreakUntil: string | null
  /** Nome do médico (vem de `doctors.full_name`, populado no JOIN da query) */
  doctorFullName?: string
}

/**
 * Procedimento publicado por médico (1:N — cada combinação tenant×médico×procedimento).
 */
export interface PublishedProcedure {
  tenantId: string
  doctorId: string
  procedureId: string
  displayName: string
  durationMinutes: number
  displayOrder: number
}

/**
 * Slot disponível retornado pela RPC `public_booking_slots`.
 * `start` e `end` são ISO 8601 UTC; cliente formata em TZ da clínica.
 */
export interface SlotDTO {
  start: string
  end: string
}

/**
 * Dados públicos da clínica retornados pela RPC `public_booking_resolve_slug`.
 * Apenas campos não-sensíveis — não inclui CNPJ, dados internos etc.
 */
export interface ResolvedTenant {
  tenantId: string
  displayName: string
  logoPath: string | null
  phone: string | null
  addressLine: string | null
  minHoursAdvance: number
  maxDaysAdvance: number
  cancelMinHours: number
}

/**
 * Payload do submit de novo agendamento público.
 * Validado por Zod antes de chegar ao core domain.
 */
export interface BookingPayload {
  doctorId: string
  procedureId: string
  /** ISO 8601 UTC */
  slotStart: string
  patient: {
    fullName: string
    cpf?: string
    email: string
    phone: string
    birthDate: string // 'YYYY-MM-DD'
  }
  lgpdConsent: true
  turnstileToken: string
}

/**
 * Resultado de uma criação bem-sucedida.
 */
export interface BookingCreatedResult {
  appointmentId: string
  /** Token raw (32 bytes base64url) — único momento em que aparece na rede. */
  cancelToken: string
  /** URL para a tela de sucesso */
  redirectUrl: string
  /** ISO 8601 UTC */
  scheduledAt: string
  /** TZ da clínica (ex.: 'America/Sao_Paulo') */
  timezone: string
}

/**
 * Códigos de erro estruturados emitidos pelas rotas API públicas.
 * Cliente mapeia para mensagens amigáveis.
 */
export type PublicBookingErrorCode =
  | 'TENANT_NOT_FOUND_OR_DISABLED'
  | 'INVALID_PAYLOAD'
  | 'INVALID_PARAMS'
  | 'CAPTCHA_FAILED'
  | 'RATE_LIMITED'
  | 'SLOT_NO_LONGER_AVAILABLE'
  | 'OUT_OF_BOOKING_WINDOW'
  | 'DOCTOR_PROCEDURE_NOT_PUBLISHED'
  | 'INVALID_SLOT_START'
  | 'TOKEN_NOT_VALID'
  | 'CANCEL_WINDOW_EXPIRED'

export interface PublicBookingError {
  error: PublicBookingErrorCode
  message?: string
  /** Segundos para Retry-After (apenas RATE_LIMITED) */
  retryAfter?: number
  /** Detalhes de validação (apenas INVALID_PAYLOAD / INVALID_PARAMS) */
  details?: Array<{ field: string; message: string }>
  /** Dados de contato da clínica (apenas CANCEL_WINDOW_EXPIRED) */
  clinicPhone?: string
  clinicEmail?: string
}

/**
 * Dados do appointment público para emails e tela de sucesso.
 */
export interface BookingEmailContext {
  patientName: string
  patientEmail: string
  clinicName: string
  clinicPhone: string | null
  clinicAddress: string | null
  doctorName: string
  procedureName: string
  scheduledAt: Date
  timezone: string
  /** Link público pra cancelar (com token raw) */
  cancelUrl: string
}

/**
 * Par token raw + hash. Token raw vai para o email; hash para o banco.
 */
export interface BookingTokenPair {
  raw: string
  hash: string
}

/**
 * Feature 018 — Motor de lembretes automáticos de consulta (Fase 1 — email).
 *
 * Tipos canônicos. Espelham o schema da migration 0094_appointment_reminders.sql.
 * Não dependem do `Database` gerado pelo Supabase para evitar acoplamento
 * antes do `supabase:gen-types` rodar (pattern existente em 017).
 */

export type ReminderChannel = 'email' | 'whatsapp' | 'sms'

export type ReminderStatus =
  | 'queued'
  | 'sent'
  | 'failed'
  | 'skipped_opt_out'
  | 'skipped_reversed'
  | 'skipped_no_email'
  | 'skipped_doctor_inactive'

/** Status finais (terminais — não admitem transição). */
export const TERMINAL_STATUSES: readonly ReminderStatus[] = [
  'sent',
  'failed',
  'skipped_opt_out',
  'skipped_reversed',
  'skipped_no_email',
  'skipped_doctor_inactive',
] as const

/**
 * Configuração de motor de lembretes por clínica (subset das 8 colunas
 * adicionadas em `tenant_clinic_profile` pela migration 0094).
 */
export interface ReminderConfig {
  enabled: boolean
  /** Antecedências em horas. 1..5 valores no range [0..168]. */
  offsetsHours: number[]
  sendWeekends: boolean
  /** Hora local (TZ tenant) início da janela permitida. Formato 'HH:MM'. */
  windowStart: string
  /** Hora local fim da janela. Formato 'HH:MM'. */
  windowEnd: string
  /** Customizado pelo admin; null = usa default do sistema. */
  templateSubject: string | null
  /** Customizado pelo admin (HTML); null = usa default. */
  templateBody: string | null
  /** Última execução do cron para este tenant (read-only). */
  lastRunAt: string | null
}

/**
 * Registro append-only de uma tentativa de envio.
 */
export interface ReminderRecord {
  id: string
  tenantId: string
  appointmentId: string
  scheduledOffsetHours: number
  channel: ReminderChannel
  status: ReminderStatus
  error: string | null
  providerMessageId: string | null
  isManual: boolean
  createdAt: string
  sentAt: string | null
}

/**
 * Agendamento elegível selecionado pelo motor — JOIN com patient/doctor/procedure
 * para evitar N+1 queries.
 *
 * Dados são lidos no momento do envio (clarificação Q4): nome do médico,
 * procedimento e contato do paciente refletem o estado VIGENTE, não o
 * estado no momento do agendamento.
 */
export interface EligibleAppointment {
  appointmentId: string
  tenantId: string
  appointmentAt: string
  doctorId: string
  doctorFullName: string
  doctorActive: boolean
  procedureId: string
  procedureName: string
  patientId: string
  patientFullName: string
  patientEmail: string | null
  remindersOptIn: boolean
  /** Se há reversal — preenchido por query antijoin. */
  isReversed: boolean
}

/**
 * Placeholders disponíveis no template customizável.
 * Todos valores são escapados em HTML antes de substituição (defesa XSS).
 */
export interface ReminderTemplatePlaceholders {
  paciente: string
  medico: string
  procedimento: string
  horario: string
  clinica: string
}

/**
 * Entrada do render-email. Reúne placeholders + dados de fallback
 * para "como cancelar" (clarificação Q3: hierarquia 3-níveis).
 */
export interface ReminderRenderInput {
  template: { subject: string | null; body: string | null }
  placeholders: ReminderTemplatePlaceholders
  /** URL pública de agendamento (slug). null se feature 017 não habilitada. */
  publicBookingUrl: string | null
  /** Telefone da clínica como fallback (Q3 nível 3). */
  clinicPhone: string | null
}

/**
 * Resultado de uma chamada de render — pronto para sendBookingEmail.
 */
export interface RenderedReminderEmail {
  subject: string
  html: string
}

/**
 * Resultado agregado de um ciclo do cron — devolvido pelo route handler.
 */
export interface ProcessBatchResult {
  processed: number
  sent: number
  failed: number
  skipped: number
  tenantsAffected: number
  durationMs: number
}

/**
 * Settings derivados de ReminderConfig para o motor (com fuso resolvido).
 */
export interface TenantReminderSettings extends ReminderConfig {
  tenantId: string
  timezone: string
}

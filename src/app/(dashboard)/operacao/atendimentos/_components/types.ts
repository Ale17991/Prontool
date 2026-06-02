/**
 * Tipos compartilhados pelo painel lateral de detalhe do atendimento
 * (feature 025). Espelham o shape retornado por `GET /api/atendimentos/{id}`
 * — quando o endpoint mudar, atualizar aqui também.
 *
 * Reutilizamos os DTOs já definidos em `lib/core/*` quando possível para
 * não duplicar tipos.
 */
import type { PatientAllergyDTO } from '@/lib/core/patient-medical/allergies'
import type { AppointmentMaterial } from '@/lib/core/appointments/materials'
import type { AppointmentProcedureLine } from '@/lib/core/appointments/procedures'

/** Embed básico do `appointments_effective` quando vem com os joins. */
export interface AppointmentEffectiveRow {
  id: string | null
  tenant_id: string | null
  patient_id: string | null
  doctor_id: string | null
  plan_id: string | null
  appointment_at: string | null
  duration_minutes: number | null
  observacoes: string | null
  frozen_amount_cents: number | null
  frozen_commission_bps: number | null
  net_amount_cents: number | null
  net_commission_cents: number | null
  effective_status: string | null
  reversal_id: string | null
  reversed_at: string | null
  procedures: { tuss_code: string; display_name: string | null } | null
  doctors: { full_name: string | null } | null
  health_plans: { name: string | null } | null
}

/** Assistant ativo (sem o `removedAt`, já filtrado). */
export interface AppointmentAssistantSummary {
  id: string
  assistantDoctorId: string
  doctorName: string
  doctorSpecialty: string | null
  frozenAmountCents: number
}

/** Resumo de uma prescrição emitida no atendimento (Feature 026). */
export interface AppointmentPrescriptionSummary {
  id: string
  memed_prescription_id: string
  status: string
  issued_at: string
}

/** Payload completo retornado por GET /api/atendimentos/{id}. */
export interface AppointmentDetailDTO {
  appointment: AppointmentEffectiveRow
  patient: { name: string; anonymized: boolean }
  procedures: AppointmentProcedureLine[]
  materials: AppointmentMaterial[]
  allergies: PatientAllergyDTO[]
  assistants: AppointmentAssistantSummary[]
  assistantsRemovedCount: number
  /** Mantido por back-compat; o painel não exibe auditoria. */
  audit: unknown[]
  /** Prescrição digital (Feature 026): se o botão "Prescrever" deve aparecer. */
  memed: { prescriberReady: boolean }
  /** Prescrições já emitidas neste atendimento. */
  prescriptions: AppointmentPrescriptionSummary[]
}

/** Estado do painel — usado pelo Host e pelo Panel. */
export type PanelMode = 'closed' | 'loading' | 'ready' | 'error'

export interface AppointmentDetailState {
  data: AppointmentDetailDTO | null
  loading: boolean
  error: { message: string; code?: string } | null
}

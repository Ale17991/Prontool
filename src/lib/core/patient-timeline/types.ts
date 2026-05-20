import type { ClinicalRecordRow } from '@/lib/core/clinical-records/create'
import type { PatientAllergyDTO } from '@/lib/core/patient-medical/allergies'
import type { PatientDiagnosisDTO } from '@/lib/core/patient-medical/diagnoses'
import type { VitalSignsDTO } from '@/lib/core/patient-medical/vital-signs'
import type { PaymentRecordDTO } from '@/lib/core/payments/list'
import type { TenantRole } from '@/lib/db/types'

export type TimelineEventKind =
  | 'anamnese'
  | 'evolucao'
  | 'texto'
  | 'arquivo'
  | 'vital'
  | 'appointment'
  | 'payment'

export interface TimelineEventBase {
  id: string
  kind: TimelineEventKind
  occurredAt: string
  authorUserId: string
  authorDisplay?: string
}

export interface AppointmentTimelineRow {
  id: string
  appointmentAt: string | null
  frozenAmountCents: number | null
  netAmountCents: number | null
  effectiveStatus: string | null
  procedureName?: string | null
  tussCode?: string | null
  doctorName?: string | null
  planName?: string | null
  createdBy?: string | null
  stepId?: string | null
}

export interface AnamneseEvent extends TimelineEventBase {
  kind: 'anamnese'
  source: ClinicalRecordRow
}

export interface EvolucaoEvent extends TimelineEventBase {
  kind: 'evolucao'
  source: ClinicalRecordRow
}

export interface TextoEvent extends TimelineEventBase {
  kind: 'texto'
  source: ClinicalRecordRow
}

export interface ArquivoEvent extends TimelineEventBase {
  kind: 'arquivo'
  source: ClinicalRecordRow
}

export interface VitalEvent extends TimelineEventBase {
  kind: 'vital'
  source: VitalSignsDTO
}

export interface AppointmentEvent extends TimelineEventBase {
  kind: 'appointment'
  source: AppointmentTimelineRow
}

export interface PaymentEvent extends TimelineEventBase {
  kind: 'payment'
  source: PaymentRecordDTO
}

export type TimelineEvent =
  | AnamneseEvent
  | EvolucaoEvent
  | TextoEvent
  | ArquivoEvent
  | VitalEvent
  | AppointmentEvent
  | PaymentEvent

export type AuthorMap = ReadonlyMap<string, string>

export type TimelineFilter =
  | 'todos'
  | 'evolucoes'
  | 'anamneses'
  | 'exames'
  | 'vitais'
  | 'atendimentos'
  | 'pagamentos'

export interface QuickViewIdentity {
  fullName: string | null
  cpf: string | null
  birthDate: string | null
  ageYears: number | null
  isAnonymized: boolean
  ghlContactId: string | null
}

export interface QuickViewContact {
  phone: string | null
  whatsappUrl: string | null
  email: string | null
}

export interface QuickViewPlan {
  id: string | null
  name: string | null
}

export interface QuickViewFinancial {
  receivedCents: number
  pendingCents: number
  lastPaidAt: string | null
}

export interface QuickViewPermissions {
  canCreateEvolution: boolean
  canCreateAnamnesis: boolean
  canCreateVital: boolean
  canCreateAllergy: boolean
  canCreateHistory: boolean
  canCreateDiagnosis: boolean
  canCreateText: boolean
  canUploadFile: boolean
  canEditPatient: boolean
  canPrint: boolean
  canDeleteAnamnese: boolean
  canImportToPlan: boolean
}

export interface QuickViewSnapshot {
  identity: QuickViewIdentity
  contact: QuickViewContact
  plan: QuickViewPlan
  allergies: PatientAllergyDTO[]
  diagnoses: PatientDiagnosisDTO[]
  lastVital: VitalSignsDTO | null
  financial: QuickViewFinancial
  permissions: QuickViewPermissions
}

export type SheetKind =
  | 'new-evolution'
  | 'new-anamnese'
  | 'new-text'
  | 'upload-file'
  | 'new-vital'
  | 'new-allergy'
  | 'new-history'
  | 'new-diagnosis'

export type { TenantRole }

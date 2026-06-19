import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { NotFoundError } from '@/lib/observability/errors'
import { createSignedUrlOrNull } from '@/lib/core/storage/signed-url'
import {
  PATIENT_PHOTO_BUCKET,
  PATIENT_PHOTO_SIGNED_URL_TTL_SECONDS,
} from './photo'

/**
 * Detalhe do paciente com PII descriptografada via RPC
 * (`get_patient_for_tenant`, migration 0027) + sumário financeiro
 * agregado de `appointments_effective` (totais, contagens, último
 * atendimento). PII vira placeholder quando o paciente foi anonimizado.
 */
export interface PatientAddress {
  cep: string | null
  street: string | null
  number: string | null
  complement: string | null
  neighborhood: string | null
  city: string | null
  state: string | null
}

export type PatientSex = 'feminino' | 'masculino' | 'intersexo'

export interface PatientDetail {
  id: string
  ghlContactId: string
  fullName: string
  socialName: string | null
  sex: PatientSex | null
  cpf: string
  rg: string | null
  motherName: string | null
  phone: string | null
  email: string | null
  birthDate: string | null
  insuranceCardNumber: string | null
  emergencyContactName: string | null
  emergencyContactPhone: string | null
  guardianName: string | null
  guardianCpf: string | null
  guardianRelationship: string | null
  address: PatientAddress
  anonymizedAt: string | null
  /** Backlog 1/5 — ativo | inativo | obito. */
  status: 'ativo' | 'inativo' | 'obito'
  /** Backlog 1/11 — aviso por paciente (pop-up). */
  alertNote: string | null
  /** Backlog 1/1 — URL assinada da foto (null se sem foto). */
  photoSignedUrl: string | null
  createdAt: string
  updatedAt: string
  healthPlan: { id: string; name: string } | null
}

export interface PatientFinancialSummary {
  appointmentCount: number
  activeAppointmentCount: number
  reversedAppointmentCount: number
  totalRevenueCents: number
  netRevenueCents: number
  lastAppointmentAt: string | null
}

export interface GetPatientResult {
  patient: PatientDetail
  summary: PatientFinancialSummary
}

interface RpcRow {
  id: string
  ghl_contact_id: string
  full_name: string | null
  social_name: string | null
  sex: string | null
  cpf: string | null
  rg: string | null
  mother_name: string | null
  phone: string | null
  email: string | null
  birth_date: string | null
  insurance_card_number: string | null
  emergency_contact_name: string | null
  emergency_contact_phone: string | null
  guardian_name: string | null
  guardian_cpf: string | null
  guardian_relationship: string | null
  address_cep: string | null
  address_street: string | null
  address_number: string | null
  address_complement: string | null
  address_neighborhood: string | null
  address_city: string | null
  address_state: string | null
  anonymized_at: string | null
  created_at: string
  updated_at: string
}

interface AppointmentSummaryRow {
  frozen_amount_cents: number | null
  net_amount_cents: number | null
  effective_status: string | null
  appointment_at: string | null
}

export async function getPatient(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; patientId: string },
): Promise<GetPatientResult> {
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) throw new Error('PATIENT_DATA_ENCRYPTION_KEY required to decrypt patient')

  const { data, error } = await supabase.rpc('get_patient_for_tenant', {
    p_tenant_id: args.tenantId,
    p_patient_id: args.patientId,
    p_key: key,
  })
  if (error) throw new Error(`get_patient_for_tenant failed: ${error.message}`)
  const rows = (data ?? []) as unknown as RpcRow[]
  const row = rows[0]
  if (!row) throw new NotFoundError('patient', args.patientId)

  // plan_id não é PII — fica fora do RPC de descriptografia. Select direto
  // com embed do health_plans pra pegar o nome numa única ida ao banco.
  const planResult = await supabase
    .from('patients')
    .select('plan_id, status, alert_note, photo_path, health_plans:plan_id ( id, name )')
    .eq('tenant_id', args.tenantId)
    .eq('id', args.patientId)
    .maybeSingle()
  const hp = (planResult.data?.health_plans ?? null) as
    | { id: string; name: string }
    | null
  const opsRow = planResult.data as
    | { status?: string | null; alert_note?: string | null; photo_path?: string | null }
    | null
  const photoSignedUrl = await createSignedUrlOrNull(
    supabase,
    PATIENT_PHOTO_BUCKET,
    opsRow?.photo_path ?? null,
    PATIENT_PHOTO_SIGNED_URL_TTL_SECONDS,
  )

  const patient: PatientDetail = {
    id: row.id,
    ghlContactId: row.ghl_contact_id,
    fullName: row.full_name ?? '',
    socialName: row.social_name,
    sex: (row.sex as PatientSex | null) ?? null,
    cpf: row.cpf ?? '',
    rg: row.rg,
    motherName: row.mother_name,
    phone: row.phone,
    email: row.email,
    birthDate: row.birth_date,
    insuranceCardNumber: row.insurance_card_number,
    emergencyContactName: row.emergency_contact_name,
    emergencyContactPhone: row.emergency_contact_phone,
    guardianName: row.guardian_name,
    guardianCpf: row.guardian_cpf,
    guardianRelationship: row.guardian_relationship,
    address: {
      cep: row.address_cep,
      street: row.address_street,
      number: row.address_number,
      complement: row.address_complement,
      neighborhood: row.address_neighborhood,
      city: row.address_city,
      state: row.address_state,
    },
    anonymizedAt: row.anonymized_at,
    status: (opsRow?.status as 'ativo' | 'inativo' | 'obito' | undefined) ?? 'ativo',
    alertNote: opsRow?.alert_note ?? null,
    photoSignedUrl,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    healthPlan: hp,
  }

  const summary = await loadSummary(supabase, args.tenantId, args.patientId)
  return { patient, summary }
}

async function loadSummary(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  patientId: string,
): Promise<PatientFinancialSummary> {
  const { data, error } = await supabase
    .from('appointments_effective')
    .select('frozen_amount_cents, net_amount_cents, effective_status, appointment_at')
    .eq('tenant_id', tenantId)
    .eq('patient_id', patientId)
  if (error) throw new Error(`appointments summary failed: ${error.message}`)

  const rows = (data ?? []) as unknown as AppointmentSummaryRow[]
  let total = 0
  let net = 0
  let active = 0
  let reversed = 0
  let last: string | null = null
  for (const r of rows) {
    total += r.frozen_amount_cents ?? 0
    net += r.net_amount_cents ?? 0
    if (r.effective_status === 'estornado') reversed += 1
    else active += 1
    if (r.appointment_at && (!last || r.appointment_at > last)) last = r.appointment_at
  }
  return {
    appointmentCount: rows.length,
    activeAppointmentCount: active,
    reversedAppointmentCount: reversed,
    totalRevenueCents: total,
    netRevenueCents: net,
    lastAppointmentAt: last,
  }
}

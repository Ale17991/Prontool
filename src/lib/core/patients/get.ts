import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { NotFoundError } from '@/lib/observability/errors'

/**
 * Detalhe do paciente com PII descriptografada via RPC
 * (`get_patient_for_tenant`, migration 0027) + sumário financeiro
 * agregado de `appointments_effective` (totais, contagens, último
 * atendimento). PII vira placeholder quando o paciente foi anonimizado.
 */
export interface PatientDetail {
  id: string
  ghlContactId: string
  fullName: string
  cpf: string
  phone: string | null
  email: string | null
  birthDate: string | null
  anonymizedAt: string | null
  createdAt: string
  updatedAt: string
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
  cpf: string | null
  phone: string | null
  email: string | null
  birth_date: string | null
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

  const patient: PatientDetail = {
    id: row.id,
    ghlContactId: row.ghl_contact_id,
    fullName: row.full_name ?? '',
    cpf: row.cpf ?? '',
    phone: row.phone,
    email: row.email,
    birthDate: row.birth_date,
    anonymizedAt: row.anonymized_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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

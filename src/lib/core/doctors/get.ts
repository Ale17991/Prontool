import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { NotFoundError } from '@/lib/observability/errors'

/**
 * Detalhe do médico + head vigente (sem histórico completo — para a
 * timeline use `listCommissionHistory`).
 */
export interface DoctorDetail {
  id: string
  fullName: string
  crm: string
  externalIdentifier: string | null
  active: boolean
  createdAt: string
  currentPercentageBps: number | null
  currentValidFrom: string | null
}

interface DoctorRow {
  id: string
  full_name: string
  crm: string
  external_identifier: string | null
  active: boolean
  created_at: string
}

interface CommissionHead {
  percentage_bps: number
  valid_from: string
}

export async function getDoctor(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; doctorId: string },
): Promise<DoctorDetail> {
  const { data: rawDoctor, error } = await supabase
    .from('doctors')
    .select('id, full_name, crm, external_identifier, active, created_at')
    .eq('id', args.doctorId)
    .eq('tenant_id', args.tenantId)
    .maybeSingle()
  if (error) throw new Error(`getDoctor failed: ${error.message}`)
  const doctor = rawDoctor as DoctorRow | null
  if (!doctor) throw new NotFoundError('doctor', args.doctorId)

  const { data: headRaw } = await supabase
    .from('doctor_commission_current')
    .select('percentage_bps, valid_from')
    .eq('tenant_id', args.tenantId)
    .eq('doctor_id', args.doctorId)
    .maybeSingle()
  const head = headRaw as CommissionHead | null

  return {
    id: doctor.id,
    fullName: doctor.full_name,
    crm: doctor.crm,
    externalIdentifier: doctor.external_identifier,
    active: doctor.active,
    createdAt: doctor.created_at,
    currentPercentageBps: head?.percentage_bps ?? null,
    currentValidFrom: head?.valid_from ?? null,
  }
}

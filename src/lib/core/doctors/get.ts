import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { NotFoundError } from '@/lib/observability/errors'
import type { PaymentMode } from '@/lib/core/payment-terms/types'

/**
 * Detalhe do profissional + modalidade vigente. Para o histórico
 * completo use `listPaymentTermsHistory`.
 */
export interface DoctorDetail {
  id: string
  fullName: string
  crm: string
  externalIdentifier: string | null
  role: string
  specialty: string | null
  councilName: string | null
  councilNumber: string | null
  councilState: string | null
  cpf: string | null
  birthDate: string | null
  /** CBO (Classificação Brasileira de Ocupações) — domínio TISS 24, 6 dígitos. */
  cbo: string | null
  active: boolean
  createdAt: string
  /** Conta de login vinculada (doctors.user_id) — null se não vinculado. */
  userId: string | null
  paymentMode: PaymentMode
  currentPercentageBps: number | null
  currentMonthlyAmountCents: number | null
  currentBillingDay: number | null
  currentLiberalDefaultCents: number | null
  currentValidFrom: string | null
}

interface DoctorRow {
  id: string
  full_name: string
  crm: string
  external_identifier: string | null
  role: string
  specialty: string | null
  council_name: string | null
  council_number: string | null
  council_state: string | null
  cpf: string | null
  birth_date: string | null
  cbo: string | null
  active: boolean
  created_at: string
  user_id: string | null
  payment_mode: PaymentMode
}

interface PaymentTermsHead {
  percentage_bps: number | null
  monthly_amount_cents: number | null
  billing_day: number | null
  liberal_default_cents: number | null
  valid_from: string
}

export async function getDoctor(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; doctorId: string },
): Promise<DoctorDetail> {
  const { data: rawDoctor, error } = await supabase
    .from('doctors')
    .select(
      'id, full_name, crm, external_identifier, role, specialty, council_name, council_number, council_state, cpf, birth_date, cbo, active, created_at, user_id, payment_mode',
    )
    .eq('id', args.doctorId)
    .eq('tenant_id', args.tenantId)
    .maybeSingle()
  if (error) throw new Error(`getDoctor failed: ${error.message}`)
  const doctor = rawDoctor as unknown as DoctorRow | null
  if (!doctor) throw new NotFoundError('doctor', args.doctorId)

  const { data: headRaw } = await supabase
    .from('doctor_payment_terms_current' as never)
    .select('percentage_bps, monthly_amount_cents, billing_day, liberal_default_cents, valid_from')
    .eq('tenant_id', args.tenantId)
    .eq('doctor_id', args.doctorId)
    .maybeSingle()
  const head = headRaw as unknown as PaymentTermsHead | null

  return {
    id: doctor.id,
    fullName: doctor.full_name,
    crm: doctor.crm,
    externalIdentifier: doctor.external_identifier,
    role: doctor.role,
    specialty: doctor.specialty,
    councilName: doctor.council_name,
    councilNumber: doctor.council_number,
    councilState: doctor.council_state,
    cpf: doctor.cpf,
    birthDate: doctor.birth_date,
    cbo: doctor.cbo,
    active: doctor.active,
    createdAt: doctor.created_at,
    userId: doctor.user_id,
    paymentMode: doctor.payment_mode,
    currentPercentageBps: head?.percentage_bps ?? null,
    currentMonthlyAmountCents: head?.monthly_amount_cents ?? null,
    currentBillingDay: head?.billing_day ?? null,
    currentLiberalDefaultCents: head?.liberal_default_cents ?? null,
    currentValidFrom: head?.valid_from ?? null,
  }
}

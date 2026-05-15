import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import type { PaymentMode } from '@/lib/core/payment-terms/types'

/**
 * Lista profissionais com modalidade vigente (`payment_mode` denormalizada
 * em `doctors`) + parâmetros vigentes consultados via `doctor_payment_terms_current`.
 *
 * Para retrocompat com a UI de comissionado, `currentPercentageBps`
 * continua disponivel (espelhando `doctor_commission_current`). Para
 * Fixo/Liberal, esse campo é 0 (espelho do commission_history.bps inicial)
 * — UI deve usar `paymentMode` para decidir qual coluna mostrar.
 */
export interface ListedDoctor {
  id: string
  fullName: string
  crm: string
  externalIdentifier: string | null
  role: string
  specialty: string | null
  councilName: string | null
  councilNumber: string | null
  active: boolean
  createdAt: string
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
  active: boolean
  created_at: string
  payment_mode: PaymentMode
}

interface PaymentTermsHead {
  doctor_id: string
  payment_mode: PaymentMode
  percentage_bps: number | null
  monthly_amount_cents: number | null
  billing_day: number | null
  liberal_default_cents: number | null
  valid_from: string
}

export async function listDoctors(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; includeInactive?: boolean },
): Promise<ListedDoctor[]> {
  let q = supabase
    .from('doctors')
    .select(
      'id, full_name, crm, external_identifier, role, specialty, council_name, council_number, active, created_at, payment_mode',
    )
    .eq('tenant_id', args.tenantId)
    .order('full_name', { ascending: true })
  if (!args.includeInactive) q = q.eq('active', true)

  const { data: rawDoctors, error } = await q
  if (error) throw new Error(`listDoctors failed: ${error.message}`)
  const doctors = (rawDoctors ?? []) as unknown as DoctorRow[]
  if (doctors.length === 0) return []

  const { data: rawHeads, error: headsErr } = await supabase
    .from('doctor_payment_terms_current' as never)
    .select(
      'doctor_id, payment_mode, percentage_bps, monthly_amount_cents, billing_day, liberal_default_cents, valid_from',
    )
    .eq('tenant_id', args.tenantId)
    .in(
      'doctor_id',
      doctors.map((d) => d.id),
    )
  if (headsErr) throw new Error(`payment terms heads query failed: ${headsErr.message}`)
  const heads = new Map<string, PaymentTermsHead>()
  for (const h of (rawHeads ?? []) as unknown as PaymentTermsHead[]) heads.set(h.doctor_id, h)

  return doctors.map((d) => {
    const h = heads.get(d.id) ?? null
    return {
      id: d.id,
      fullName: d.full_name,
      crm: d.crm,
      externalIdentifier: d.external_identifier,
      role: d.role,
      specialty: d.specialty,
      councilName: d.council_name,
      councilNumber: d.council_number,
      active: d.active,
      createdAt: d.created_at,
      paymentMode: d.payment_mode,
      currentPercentageBps: h?.percentage_bps ?? null,
      currentMonthlyAmountCents: h?.monthly_amount_cents ?? null,
      currentBillingDay: h?.billing_day ?? null,
      currentLiberalDefaultCents: h?.liberal_default_cents ?? null,
      currentValidFrom: h?.valid_from ?? null,
    }
  })
}

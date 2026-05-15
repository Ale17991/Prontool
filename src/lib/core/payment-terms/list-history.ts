import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import type { PaymentTermsCurrent, PaymentTermsRow } from './types'
import { resolveCurrentPaymentTerms } from './resolve-current'

export interface PaymentTermsHistoryResult {
  current: PaymentTermsCurrent | null
  history: PaymentTermsRow[]
}

/**
 * Retorna o head-of-chain + lista completa do histórico de modalidades
 * de pagamento de um doctor. Ordenacao desc por `valid_from` + `created_at`
 * (mais recentes primeiro), consistente com a view `doctor_payment_terms_current`.
 */
export async function listPaymentTermsHistory(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; doctorId: string },
): Promise<PaymentTermsHistoryResult> {
  const current = await resolveCurrentPaymentTerms(supabase, args)

  const { data, error } = await supabase
    .from('doctor_payment_terms_history' as never)
    .select(
      'id, tenant_id, doctor_id, payment_mode, percentage_bps, monthly_amount_cents, billing_day, liberal_default_cents, valid_from, reason, created_by, created_at',
    )
    .eq('tenant_id', args.tenantId)
    .eq('doctor_id', args.doctorId)
    .order('valid_from', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(`listPaymentTermsHistory failed: ${error.message}`)
  }

  const history: PaymentTermsRow[] = ((data ?? []) as Array<{
    id: string
    tenant_id: string
    doctor_id: string
    payment_mode: 'comissionado' | 'fixo' | 'liberal'
    percentage_bps: number | null
    monthly_amount_cents: number | null
    billing_day: number | null
    liberal_default_cents: number | null
    valid_from: string
    reason: string
    created_by: string
    created_at: string
  }>).map((r) => ({
    id: r.id,
    tenantId: r.tenant_id,
    doctorId: r.doctor_id,
    paymentMode: r.payment_mode,
    percentageBps: r.percentage_bps,
    monthlyAmountCents: r.monthly_amount_cents,
    billingDay: r.billing_day,
    liberalDefaultCents: r.liberal_default_cents,
    validFrom: r.valid_from,
    reason: r.reason,
    createdBy: r.created_by,
    createdAt: r.created_at,
  }))

  return { current, history }
}

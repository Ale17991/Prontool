import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import type { PaymentTermsCurrent } from './types'

/**
 * Le a linha vigente em `doctor_payment_terms_current` (head-of-chain)
 * para um doctor especifico. Retorna `null` se nao houver registro
 * (não esperado em runtime — todos os doctors recebem 1 row inicial via
 * backfill ou createDoctor; mantemos `null` defensivo).
 */
export async function resolveCurrentPaymentTerms(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; doctorId: string },
): Promise<PaymentTermsCurrent | null> {
  const { data, error } = await supabase
    .from('doctor_payment_terms_current' as never)
    .select(
      'doctor_id, payment_mode, percentage_bps, monthly_amount_cents, billing_day, liberal_default_cents, valid_from, created_at',
    )
    .eq('tenant_id', args.tenantId)
    .eq('doctor_id', args.doctorId)
    .maybeSingle()

  if (error) {
    throw new Error(`resolveCurrentPaymentTerms failed: ${error.message}`)
  }
  if (!data) return null

  const row = data as unknown as {
    doctor_id: string
    payment_mode: 'comissionado' | 'fixo' | 'liberal'
    percentage_bps: number | null
    monthly_amount_cents: number | null
    billing_day: number | null
    liberal_default_cents: number | null
    valid_from: string
    created_at: string
  }
  return {
    doctorId: row.doctor_id,
    paymentMode: row.payment_mode,
    percentageBps: row.percentage_bps,
    monthlyAmountCents: row.monthly_amount_cents,
    billingDay: row.billing_day,
    liberalDefaultCents: row.liberal_default_cents,
    validFrom: row.valid_from,
    createdAt: row.created_at,
  }
}

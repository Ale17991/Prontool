import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

export interface MonthlyFixedPayLine {
  doctorId: string
  doctorName: string
  amountCents: number
  billingDay: number
  monthStart: string
  billingDate: string
}

/**
 * Le a view virtualizada `monthly_fixed_pay_lines` filtrando por
 * tenant + mês (YYYY-MM). A view só retorna linhas para profissionais
 * Fixos ATIVOS a partir do `billing_day` configurado (Decisão 6).
 */
export async function selectMonthlyFixedPayLines(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; year: number; month: number /* 1..12 */ },
): Promise<MonthlyFixedPayLine[]> {
  const fromDate = new Date(Date.UTC(args.year, args.month - 1, 1))
  const toDate = new Date(Date.UTC(args.year, args.month, 1))

  const { data, error } = await supabase
    .from('monthly_fixed_pay_lines' as never)
    .select('doctor_id, doctor_name, amount_cents, billing_day, month_start, billing_date')
    .eq('tenant_id', args.tenantId)
    .gte('month_start', fromDate.toISOString().slice(0, 10))
    .lt('month_start', toDate.toISOString().slice(0, 10))
    .order('billing_date', { ascending: true })

  if (error) {
    throw new Error(`selectMonthlyFixedPayLines failed: ${error.message}`)
  }

  return (
    (data ?? []) as unknown as Array<{
      doctor_id: string
      doctor_name: string
      amount_cents: number
      billing_day: number
      month_start: string
      billing_date: string
    }>
  ).map((r) => ({
    doctorId: r.doctor_id,
    doctorName: r.doctor_name,
    amountCents: r.amount_cents,
    billingDay: r.billing_day,
    monthStart: r.month_start,
    billingDate: r.billing_date,
  }))
}

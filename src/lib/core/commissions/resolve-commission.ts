import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { DomainError } from '@/lib/observability/errors'

/**
 * T080 — resolve the commission row active for a doctor at a given date.
 * Mirrors `resolve-price.ts`: newest `valid_from <= asOf`, ties by
 * `created_at DESC`.
 */
export interface ResolveCommissionInput {
  tenantId: string
  doctorId: string
  asOf: Date
}

export interface ResolvedCommission {
  commissionHistoryId: string
  percentageBps: number
  validFrom: string
}

export async function resolveCommission(
  supabase: SupabaseClient<Database>,
  input: ResolveCommissionInput,
): Promise<ResolvedCommission> {
  const asOfDate = input.asOf.toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('doctor_commission_history')
    .select('id, percentage_bps, valid_from, created_at')
    .eq('tenant_id', input.tenantId)
    .eq('doctor_id', input.doctorId)
    .lte('valid_from', asOfDate)
    .order('valid_from', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`resolveCommission query failed: ${error.message}`)
  if (!data) {
    throw new DomainError(
      'COMMISSION_MISSING',
      `No active commission row for doctor ${input.doctorId} at ${asOfDate}`,
      { meta: { tenant_id: input.tenantId, doctor_id: input.doctorId, as_of: asOfDate } },
    )
  }
  return {
    commissionHistoryId: data.id,
    percentageBps: data.percentage_bps,
    validFrom: data.valid_from,
  }
}

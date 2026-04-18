import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

/**
 * Histórico completo de comissão de um médico ordenado por valid_from
 * DESC (mais recente primeiro, igual à timeline da UI).
 */
export interface CommissionHistoryRow {
  id: string
  doctorId: string
  percentageBps: number
  validFrom: string
  reason: string
  createdAt: string
  createdBy: string | null
}

interface DbRow {
  id: string
  doctor_id: string
  percentage_bps: number
  valid_from: string
  reason: string
  created_at: string
  created_by: string | null
}

export async function listCommissionHistory(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; doctorId: string },
): Promise<CommissionHistoryRow[]> {
  const { data, error } = await supabase
    .from('doctor_commission_history')
    .select('id, doctor_id, percentage_bps, valid_from, reason, created_at, created_by')
    .eq('tenant_id', args.tenantId)
    .eq('doctor_id', args.doctorId)
    .order('valid_from', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw new Error(`listCommissionHistory failed: ${error.message}`)

  return ((data ?? []) as DbRow[]).map((r) => ({
    id: r.id,
    doctorId: r.doctor_id,
    percentageBps: r.percentage_bps,
    validFrom: r.valid_from,
    reason: r.reason,
    createdAt: r.created_at,
    createdBy: r.created_by,
  }))
}

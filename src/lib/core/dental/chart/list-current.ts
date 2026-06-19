import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import type { Surface } from '@/lib/core/dental/teeth'

export interface CurrentChartEntryDTO {
  id: string
  toothFdi: number
  surface: Surface | null
  statusId: string
  note: string | null
  recordedAt: string
  appointmentId: string | null
  createdBy: string
}

/**
 * Estado atual do odontograma: último registro por (dente, face), via RPC
 * `dental_chart_current` (DISTINCT ON). Entradas com status `none` continuam
 * na lista — o cliente as renderiza como "sem registro".
 */
export async function listCurrentChart(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; patientId: string },
): Promise<CurrentChartEntryDTO[]> {
  const { data, error } = await supabase.rpc('dental_chart_current', {
    p_tenant_id: args.tenantId,
    p_patient_id: args.patientId,
  })
  if (error) throw new Error(`listCurrentChart failed: ${error.message}`)
  return (data ?? []).map((r) => ({
    id: r.id,
    toothFdi: r.tooth_fdi,
    surface: (r.surface as Surface | null) ?? null,
    statusId: r.status_id,
    note: r.note,
    recordedAt: r.recorded_at,
    appointmentId: r.appointment_id,
    createdBy: r.created_by,
  }))
}

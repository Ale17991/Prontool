import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import type { Surface } from '@/lib/core/dental/teeth'

export interface ChartHistoryEntryDTO {
  id: string
  toothFdi: number
  surface: Surface | null
  statusId: string
  statusCode: string | null
  statusLabel: string | null
  note: string | null
  recordedAt: string
  appointmentId: string | null
  createdBy: string
}

interface HistoryRow {
  id: string
  tooth_fdi: number
  surface: string | null
  status_id: string
  note: string | null
  recorded_at: string
  appointment_id: string | null
  created_by: string
  dental_status_catalog: { code: string; label: string } | null
}

/**
 * Histórico append-only por posição (US3). Sem `surface` → todas as marcações
 * do dente (faces + escopo dente); com `surface` → só aquela face.
 */
export async function listChartHistory(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; patientId: string; toothFdi: number; surface?: Surface | null },
): Promise<ChartHistoryEntryDTO[]> {
  let query = supabase
    .from('dental_chart_entries')
    .select(
      'id, tooth_fdi, surface, status_id, note, recorded_at, appointment_id, created_by, dental_status_catalog(code, label)',
    )
    .eq('tenant_id', args.tenantId)
    .eq('patient_id', args.patientId)
    .eq('tooth_fdi', args.toothFdi)
    .order('recorded_at', { ascending: false })

  if (args.surface !== undefined && args.surface !== null) {
    query = query.eq('surface', args.surface)
  }

  const { data, error } = await query
  if (error) throw new Error(`listChartHistory failed: ${error.message}`)

  return ((data ?? []) as unknown as HistoryRow[]).map((r) => ({
    id: r.id,
    toothFdi: r.tooth_fdi,
    surface: (r.surface as Surface | null) ?? null,
    statusId: r.status_id,
    statusCode: r.dental_status_catalog?.code ?? null,
    statusLabel: r.dental_status_catalog?.label ?? null,
    note: r.note,
    recordedAt: r.recorded_at,
    appointmentId: r.appointment_id,
    createdBy: r.created_by,
  }))
}

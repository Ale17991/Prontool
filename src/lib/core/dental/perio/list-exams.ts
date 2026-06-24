import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { perioIndicators, type PerioIndicatorsDTO } from './get-exam'

export interface PerioExamSummary {
  id: string
  examDate: string
  status: 'rascunho' | 'finalizado'
  dentition: 'permanent' | 'deciduous'
  finalizedAt: string | null
  indicators: PerioIndicatorsDTO
}

export interface PerioListView {
  exams: PerioExamSummary[]
  draftId: string | null
}

/**
 * Lista os exames periodontais do paciente (mais recentes primeiro) com
 * indicadores resumidos por exame e o id do rascunho aberto (se houver).
 */
export async function listPerioExams(
  supabase: SupabaseClient<Database>,
  input: { tenantId: string; patientId: string },
): Promise<PerioListView> {
  const res = await supabase
    .from('perio_exams')
    .select('id, exam_date, status, dentition, finalized_at')
    .eq('tenant_id', input.tenantId)
    .eq('patient_id', input.patientId)
    .order('exam_date', { ascending: false })
    .order('created_at', { ascending: false })
  if (res.error) throw new Error(`listPerioExams: ${res.error.message}`)

  const rows = res.data ?? []
  const indicators = await Promise.all(
    rows.map((r) => perioIndicators(supabase, input.tenantId, r.id)),
  )

  const exams: PerioExamSummary[] = rows.map((r, i) => ({
    id: r.id,
    examDate: r.exam_date,
    status: r.status as 'rascunho' | 'finalizado',
    dentition: r.dentition as 'permanent' | 'deciduous',
    finalizedAt: r.finalized_at,
    indicators: indicators[i]!,
  }))

  return {
    exams,
    draftId: exams.find((e) => e.status === 'rascunho')?.id ?? null,
  }
}

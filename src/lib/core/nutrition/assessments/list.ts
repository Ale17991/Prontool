import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

/**
 * Feature 046 — histórico de avaliações de um paciente (mais recente primeiro).
 */
export interface AssessmentSummary {
  id: string
  assessedAt: string
  dobraProtocol: string | null
  tmbEquation: string | null
  fatPct: number | null
  imc: number | null
  tmbKcal: number | null
  getKcal: number | null
  targetKcal: number | null
  createdAt: string
}

const SUMMARY_COLS =
  'id, assessed_at, dobra_protocol, tmb_equation, fat_pct, imc, tmb_kcal, get_kcal, target_kcal, created_at'

interface Row {
  id: string
  assessed_at: string
  dobra_protocol: string | null
  tmb_equation: string | null
  fat_pct: number | null
  imc: number | null
  tmb_kcal: number | null
  get_kcal: number | null
  target_kcal: number | null
  created_at: string
}

export async function listNutritionAssessments(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; patientId: string },
): Promise<AssessmentSummary[]> {
  const { data, error } = await supabase
    .from('nutrition_assessments')
    .select(SUMMARY_COLS)
    .eq('tenant_id', args.tenantId)
    .eq('patient_id', args.patientId)
    .order('assessed_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw new Error(`listNutritionAssessments failed: ${error.message}`)
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    assessedAt: r.assessed_at,
    dobraProtocol: r.dobra_protocol,
    tmbEquation: r.tmb_equation,
    fatPct: r.fat_pct === null ? null : Number(r.fat_pct),
    imc: r.imc === null ? null : Number(r.imc),
    tmbKcal: r.tmb_kcal === null ? null : Number(r.tmb_kcal),
    getKcal: r.get_kcal === null ? null : Number(r.get_kcal),
    targetKcal: r.target_kcal === null ? null : Number(r.target_kcal),
    createdAt: r.created_at,
  }))
}

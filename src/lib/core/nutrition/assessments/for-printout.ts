import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

/**
 * Feature 054 US2 — leitura das avaliações para o impresso de evolução.
 *
 * O `AssessmentSummary` da 046 serve à lista da tela e traz só o essencial
 * (IMC, %gordura, GET). O impresso mostra a composição corporal inteira lado a
 * lado, então precisa de peso, massa magra e gorda, circunferências e as
 * classificações — que já estão gravados no snapshot e só não eram lidos.
 *
 * Nenhum valor é recalculado: `nutrition_assessments` é um snapshot imutável do
 * que foi calculado no dia. Recalcular hoje com as fórmulas de hoje mudaria o
 * passado — e a revisão de fórmulas de agosto tornou isso concreto: uma
 * avaliação de julho feita com Petroski quadrático precisa continuar mostrando
 * o número de julho.
 */

export interface AssessmentForPrint {
  id: string
  assessedAt: string
  weightKg: number
  heightCm: number | null
  dobraProtocol: string | null
  fatPct: number | null
  fatMassKg: number | null
  leanMassKg: number | null
  imc: number | null
  imcClass: string | null
  waistHipRatio: number | null
  waistHipClass: string | null
  tmbEquation: string | null
  tmbKcal: number | null
  getKcal: number | null
  targetKcal: number | null
  circumferences: Record<string, number>
}

const COLS =
  'id, assessed_at, weight_kg, height_cm, dobra_protocol, fat_pct, fat_mass_kg, lean_mass_kg, ' +
  'imc, imc_class, waist_hip_ratio, waist_hip_class, tmb_equation, tmb_kcal, get_kcal, ' +
  'target_kcal, circumferences'

const n = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null

/**
 * As `limit` avaliações mais recentes, devolvidas da **mais antiga para a mais
 * nova** — que é a ordem de leitura do impresso, da esquerda para a direita.
 */
export async function listAssessmentsForPrintout(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; patientId: string; limit?: number },
): Promise<AssessmentForPrint[]> {
  const limit = Math.min(Math.max(args.limit ?? 3, 1), 3)
  const { data, error } = await supabase
    .from('nutrition_assessments')
    .select(COLS)
    .eq('tenant_id', args.tenantId)
    .eq('patient_id', args.patientId)
    .order('assessed_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`listAssessmentsForPrintout: ${error.message}`)

  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>
  return rows
    .map((r) => ({
      id: r.id as string,
      assessedAt: String(r.assessed_at).slice(0, 10),
      weightKg: Number(r.weight_kg),
      heightCm: n(r.height_cm),
      dobraProtocol: (r.dobra_protocol as string | null) ?? null,
      fatPct: n(r.fat_pct),
      fatMassKg: n(r.fat_mass_kg),
      leanMassKg: n(r.lean_mass_kg),
      imc: n(r.imc),
      imcClass: (r.imc_class as string | null) ?? null,
      waistHipRatio: n(r.waist_hip_ratio),
      waistHipClass: (r.waist_hip_class as string | null) ?? null,
      tmbEquation: (r.tmb_equation as string | null) ?? null,
      tmbKcal: n(r.tmb_kcal),
      getKcal: n(r.get_kcal),
      targetKcal: n(r.target_kcal),
      circumferences: (r.circumferences as Record<string, number> | null) ?? {},
    }))
    .reverse()
}

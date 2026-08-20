import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { DomainError, NotFoundError } from '@/lib/observability/errors'
import { recordMeasurementsBatch } from '@/lib/core/patient-portal/measurements'
import type { Sex } from '../age-sex'
import type { CircumferenceSite, DobraProtocol, SkinfoldSite, TmbEquation } from '../protocols'
import {
  computeComposition,
  NutritionInputError,
  type CompositionResult,
} from '../body-composition'
import { computeEnergy, type EnergyResult } from '../energy'

/**
 * Feature 046 — cria uma avaliação nutricional: calcula composição e/ou gasto
 * energético, grava o snapshot imutável em `nutrition_assessments` e lança os
 * derivados no motor de medições (feature 030) com a mesma data.
 *
 * `sex`/`ageYears` são congelados na avaliação (vêm do formulário, pré-preenchidos
 * a partir do paciente). Pelo menos um bloco (composição ou energia) é exigido.
 */
export interface CreateAssessmentInput {
  tenantId: string
  patientId: string
  actorUserId: string
  assessedAt: string
  sex: Sex
  ageYears: number
  weightKg: number
  heightCm?: number | null
  // Bloco de composição (opcional)
  dobraProtocol?: DobraProtocol | null
  skinfolds?: Partial<Record<SkinfoldSite, number>> | null
  circumferences?: Partial<Record<CircumferenceSite, number>> | null
  fatPctInput?: number | null
  // Bloco de energia (opcional)
  tmbEquation?: TmbEquation | null
  activityFactor?: number | null
  injuryFactor?: number | null
  extraKcal?: number | null
  eerPa?: number | null
  eerCategory?: 1 | 2 | 3 | 4 | null
  pregnancyWeeks?: number | null
  pregnancyDepositKcal?: number | null
  objective?: 'deficit' | 'manutencao' | 'superavit' | null
  objectiveDeltaKcal?: number | null
  macros?: {
    protPct?: number
    carbPct?: number
    lipPct?: number
    protGkg?: number
    carbGkg?: number
    lipGkg?: number
  } | null
  notes?: string | null
}

export interface CreateAssessmentResult {
  id: string
  composition: CompositionResult | null
  energy: EnergyResult | null
}

/** Converte um NutritionInputError do motor em DomainError 422. */
function run<T>(fn: () => T): T {
  try {
    return fn()
  } catch (err) {
    if (err instanceof NutritionInputError) {
      throw new DomainError(err.code, err.message, { status: 422 })
    }
    throw err
  }
}

export async function createNutritionAssessment(
  supabase: SupabaseClient<Database>,
  input: CreateAssessmentInput,
): Promise<CreateAssessmentResult> {
  const hasComposition = !!input.dobraProtocol
  const hasEnergy = !!input.tmbEquation
  if (!hasComposition && !hasEnergy) {
    throw new DomainError(
      'ASSESSMENT_EMPTY',
      'Informe ao menos composição corporal ou gasto energético.',
      {
        status: 422,
      },
    )
  }

  // Paciente precisa pertencer ao tenant da sessão.
  const pat = await supabase
    .from('patients')
    .select('id')
    .eq('tenant_id', input.tenantId)
    .eq('id', input.patientId)
    .maybeSingle()
  if (pat.error) throw new Error(`patient lookup failed: ${pat.error.message}`)
  if (!pat.data) throw new NotFoundError('patient', input.patientId)

  // 1) Composição corporal.
  let composition: CompositionResult | null = null
  if (hasComposition) {
    composition = run(() =>
      computeComposition({
        sex: input.sex,
        ageYears: input.ageYears,
        weightKg: input.weightKg,
        heightCm: input.heightCm ?? null,
        protocol: input.dobraProtocol!,
        skinfolds: input.skinfolds ?? {},
        circumferences: input.circumferences ?? {},
        fatPctInput: input.fatPctInput ?? null,
      }),
    )
  }

  // 2) Gasto energético (usa a massa magra da composição quando a equação exige).
  let energy: EnergyResult | null = null
  if (hasEnergy) {
    energy = run(() =>
      computeEnergy({
        sex: input.sex,
        ageYears: input.ageYears,
        weightKg: input.weightKg,
        heightCm: input.heightCm ?? null,
        leanMassKg: composition?.leanMassKg ?? null,
        equation: input.tmbEquation!,
        activityFactor: input.activityFactor ?? null,
        injuryFactor: input.injuryFactor ?? null,
        extraKcal: input.extraKcal ?? null,
        eerPa: input.eerPa ?? null,
        eerCategory: input.eerCategory ?? null,
        pregnancyWeeks: input.pregnancyWeeks ?? null,
        pregnancyDepositKcal: input.pregnancyDepositKcal ?? null,
        objective: input.objective ?? null,
        objectiveDeltaKcal: input.objectiveDeltaKcal ?? null,
        macros: input.macros ?? null,
      }),
    )
  }

  // 3) Grava o snapshot imutável.
  const { data, error } = await supabase
    .from('nutrition_assessments')
    .insert({
      tenant_id: input.tenantId,
      patient_id: input.patientId,
      assessed_at: input.assessedAt,
      sex: input.sex,
      age_years: input.ageYears,
      weight_kg: input.weightKg,
      height_cm: input.heightCm ?? null,
      skinfolds: (input.skinfolds ?? {}) as never,
      circumferences: (input.circumferences ?? {}) as never,
      dobra_protocol: input.dobraProtocol ?? null,
      body_density: composition?.bodyDensity ?? null,
      fat_pct: composition?.fatPct ?? null,
      fat_mass_kg: composition?.fatMassKg ?? null,
      lean_mass_kg: composition?.leanMassKg ?? null,
      imc: composition?.imc ?? null,
      imc_class: composition?.imcClass ?? null,
      waist_hip_ratio: composition?.waistHipRatio ?? null,
      waist_hip_class: composition?.waistHipClass ?? null,
      tmb_equation: input.tmbEquation ?? null,
      tmb_kcal: energy?.tmbKcal ?? null,
      activity_factor: input.activityFactor ?? null,
      injury_factor: input.injuryFactor ?? 1.0,
      extra_kcal: input.extraKcal ?? 0,
      get_kcal: energy?.getKcal ?? null,
      objective: input.objective ?? null,
      objective_delta_kcal: input.objectiveDeltaKcal ?? null,
      target_kcal: energy?.targetKcal ?? null,
      target_macros: (energy?.macros ?? null) as never,
      notes: input.notes?.trim() || null,
      created_by_user_id: input.actorUserId,
    } as never)
    .select('id')
    .single()
  if (error || !data) throw new Error(`createNutritionAssessment insert failed: ${error?.message}`)
  const id = (data as unknown as { id: string }).id

  // 4) Lança os derivados no motor de medições (best-effort — a avaliação é a
  //    fonte da verdade; as métricas são o espelho para os gráficos/portal).
  const entries: { metricType: string; value: number }[] = [
    { metricType: 'peso', value: input.weightKg },
  ]
  if (composition) {
    entries.push({ metricType: 'percentual_gordura', value: composition.fatPct })
    entries.push({ metricType: 'massa_gorda_kg', value: composition.fatMassKg })
    entries.push({ metricType: 'massa_magra_kg', value: composition.leanMassKg })
    if (composition.imc !== null) entries.push({ metricType: 'imc', value: composition.imc })
  }
  if (energy) {
    entries.push({ metricType: 'taxa_metabolica_basal', value: energy.tmbKcal })
    entries.push({ metricType: 'gasto_energetico_total', value: energy.getKcal })
  }
  try {
    await recordMeasurementsBatch(supabase, {
      tenantId: input.tenantId,
      patientId: input.patientId,
      measuredAt: input.assessedAt,
      notes: 'Avaliação nutricional',
      entries,
      actorUserId: input.actorUserId,
    })
  } catch {
    // best-effort — não derruba a avaliação já gravada.
  }

  return { id, composition, energy }
}

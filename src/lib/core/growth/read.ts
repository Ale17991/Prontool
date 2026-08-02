import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import {
  ageInMonths,
  classifyGrowth,
  GROWTH_LABEL,
  MAX_PEDIATRIC_AGE_MONTHS,
  type GrowthIndicator,
  type GrowthResult,
  type PercentileRow,
} from './classify'

/**
 * Curvas de crescimento — leitura.
 *
 * Não há tabela de medição nova: peso, estatura e IMC saem de `vital_signs`,
 * onde já são aferidos na consulta. A curva cruza isso com os percentis globais
 * e a data de nascimento. Consequência: quem já registrava sinais vitais tem a
 * curva de graça, sem redigitar nada.
 */

function loose(sb: SupabaseClient<Database>): SupabaseClient {
  return sb as unknown as SupabaseClient
}

export interface GrowthPoint {
  measuredAt: string
  ageMonths: number
  value: number
  percentile: number
  classification: string
  label: string
}

export interface GrowthCurve {
  indicator: GrowthIndicator
  label: string
  unit: string
  points: GrowthPoint[]
  /** Bandas para o gráfico: um ponto por mês na janela observada. */
  bands: PercentileRow[]
  latest: GrowthResult | null
}

export interface GrowthReport {
  /** `null` quando falta nascimento ou sexo — a curva não é calculável. */
  curves: GrowthCurve[]
  ageMonthsNow: number | null
  missing: { birthDate: boolean; sex: boolean }
  /** Fora da faixa pediátrica: a curva não se aplica. */
  outOfRange: boolean
}

const UNIT: Record<GrowthIndicator, string> = {
  peso_idade: 'kg',
  estatura_idade: 'cm',
  imc_idade: 'kg/m²',
}

async function loadPercentiles(
  sb: SupabaseClient<Database>,
  indicator: GrowthIndicator,
  sex: 'M' | 'F',
): Promise<PercentileRow[]> {
  const res = await loose(sb)
    .from('growth_percentiles')
    .select('age_months, p01, p3, p5, p10, p15, p50, p85, p97, p999')
    .eq('indicator', indicator)
    .eq('sex', sex)
    .order('age_months', { ascending: true })
  return ((res.data ?? []) as Array<Record<string, number | string>>).map((r) => ({
    ageMonths: Number(r.age_months),
    p01: Number(r.p01),
    p3: Number(r.p3),
    p5: Number(r.p5),
    p10: Number(r.p10),
    p15: Number(r.p15),
    p50: Number(r.p50),
    p85: Number(r.p85),
    p97: Number(r.p97),
    p999: Number(r.p999),
  }))
}

/**
 * O cadastro guarda `masculino`/`feminino`/`intersexo`; as curvas da OMS só
 * existem em duas versões. Intersexo devolve `null` de propósito: escolher uma
 * curva por conta própria seria decidir clinicamente no lugar da profissional —
 * a tela pede que ela informe qual referência usar.
 */
function normalizeSex(sex: string | null): 'M' | 'F' | null {
  if (!sex) return null
  const s = sex.toLowerCase()
  if (s === 'm' || s === 'masculino') return 'M'
  if (s === 'f' || s === 'feminino') return 'F'
  return null
}

interface VitalRow {
  measured_at: string
  weight_grams: number | null
  height_cm: number | null
  bmi: number | null
}

/**
 * Monta as três curvas do paciente.
 *
 * `sex` e `birthDate` vêm do cadastro; ambos são opcionais no produto, e sem
 * eles a curva simplesmente não existe — a tela pede o dado em vez de exibir
 * uma classificação chutada. Mesma decisão tomada nas faixas laboratoriais.
 */
export async function buildGrowthReport(
  sb: SupabaseClient<Database>,
  args: {
    tenantId: string
    patientId: string
    birthDate: string | null
    sex: string | null
    today: string
  },
): Promise<GrowthReport> {
  const normalizedSex = normalizeSex(args.sex)
  const missing = { birthDate: !args.birthDate, sex: !normalizedSex }
  if (!args.birthDate || !normalizedSex) {
    return { curves: [], ageMonthsNow: null, missing, outOfRange: false }
  }

  const ageNow = ageInMonths(args.birthDate, args.today)
  if (ageNow > MAX_PEDIATRIC_AGE_MONTHS) {
    return { curves: [], ageMonthsNow: ageNow, missing, outOfRange: true }
  }

  const vitalsRes = await loose(sb)
    .from('vital_signs')
    .select('measured_at, weight_grams, height_cm, bmi')
    .eq('tenant_id', args.tenantId)
    .eq('patient_id', args.patientId)
    .order('measured_at', { ascending: true })
    .limit(400)
  const vitals = (vitalsRes.data ?? []) as VitalRow[]

  const indicators: GrowthIndicator[] = ['peso_idade', 'estatura_idade', 'imc_idade']
  const curves: GrowthCurve[] = []

  for (const indicator of indicators) {
    const rows = await loadPercentiles(sb, indicator, normalizedSex)
    if (rows.length === 0) continue

    const points: GrowthPoint[] = []
    for (const v of vitals) {
      const raw =
        indicator === 'peso_idade'
          ? v.weight_grams === null
            ? null
            : Number(v.weight_grams) / 1000
          : indicator === 'estatura_idade'
            ? v.height_cm === null
              ? null
              : Number(v.height_cm)
            : v.bmi === null
              ? null
              : Number(v.bmi)
      if (raw === null || !Number.isFinite(raw) || raw <= 0) continue

      const at = String(v.measured_at).slice(0, 10)
      const age = ageInMonths(args.birthDate, at)
      const r = classifyGrowth({ indicator, rows, ageMonths: age, value: raw })
      if (!r) continue
      points.push({
        measuredAt: at,
        ageMonths: age,
        value: raw,
        percentile: r.percentile,
        classification: r.classification,
        label: r.label,
      })
    }

    // A banda do gráfico cobre da idade mais nova observada até hoje, com uma
    // folga de 2 meses de cada lado para o ponto não colar na borda.
    const minAge = Math.max(0, Math.floor((points[0]?.ageMonths ?? ageNow) - 2))
    const maxAge = Math.ceil(ageNow + 2)
    const bands = rows.filter((r) => r.ageMonths >= minAge && r.ageMonths <= maxAge)

    const last = points[points.length - 1]
    curves.push({
      indicator,
      label: GROWTH_LABEL[indicator],
      unit: UNIT[indicator],
      points,
      bands,
      latest: last
        ? classifyGrowth({ indicator, rows, ageMonths: last.ageMonths, value: last.value })
        : null,
    })
  }

  return { curves, ageMonthsNow: ageNow, missing, outOfRange: false }
}

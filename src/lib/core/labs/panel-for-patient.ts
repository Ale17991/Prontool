/**
 * Feature 050 — painel laboratorial do paciente, pronto para leitura.
 *
 * Extraído da rota `/api/pacientes/[id]/exames` na feature 054: o impresso e a
 * tela precisam do MESMO painel. Duplicar a montagem faria o papel e a tela
 * divergirem na primeira correção feita em um só dos dois lugares — que é
 * exatamente o risco que esta feature existe para não criar.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { listMeasurements } from '@/lib/core/patient-portal/measurements'
import { isLabAnalyte } from '@/lib/core/labs/catalog'
import {
  classifyLabResults,
  type LabPanelResult,
  type LabResultInput,
} from '@/lib/core/labs/classify'
import {
  listLabRangesForPatient,
  listSexDependentAnalytes,
  type LabSex,
  type LabState,
} from '@/lib/core/labs/reference-ranges'

export interface LabPanelOverrides {
  /** Sobrescreve o cadastro — a tela permite ajustar sem bloquear. */
  ageYears?: number | null
  sex?: LabSex | null
  state?: LabState
}

export interface LabPanelForPatient {
  patient: { ageYears: number | null; sex: LabSex | null; state: LabState }
  panel: LabPanelResult
  series: Record<string, Array<{ measuredAt: string; value: number }>>
  need: { age: boolean; sex: boolean; blockedBySex: number }
}

/**
 * Query params sobrescrevem o cadastro — a tela ajusta sexo/idade sem bloquear,
 * e o impresso precisa aceitar os mesmos parâmetros para sair igual ao que está
 * na tela no momento em que a profissional clica em imprimir.
 */
export function labOverridesFromUrl(url: URL): Required<LabPanelOverrides> {
  const rawAge = url.searchParams.get('age')
  let ageYears = rawAge !== null && rawAge !== '' ? Number(rawAge) : null
  if (ageYears !== null && !Number.isFinite(ageYears)) ageYears = null
  let sex = url.searchParams.get('sex') as LabSex | null
  if (sex !== 'M' && sex !== 'F') sex = null
  const stateParam = url.searchParams.get('state')
  const state: LabState =
    stateParam === 'gestante' || stateParam === 'lactante' ? stateParam : 'padrao'
  return { ageYears, sex, state }
}

function ageFromBirth(iso: string): number | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const now = new Date()
  let a = now.getFullYear() - d.getFullYear()
  const m = now.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--
  return a >= 0 && a < 130 ? a : null
}

/**
 * Quando falta sexo ou idade, devolve os resultados mesmo assim com os analitos
 * dependentes marcados `sem_referencia` e `need` preenchido — a tela pede o dado
 * que falta em vez de bloquear o registro (FR-006).
 */
export async function buildLabPanelForPatient(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; patientId: string; overrides?: LabPanelOverrides },
): Promise<LabPanelForPatient> {
  const byMetric = await listMeasurements(supabase, {
    tenantId: args.tenantId,
    patientId: args.patientId,
  })

  const results: LabResultInput[] = []
  const series: Record<string, Array<{ measuredAt: string; value: number }>> = {}
  for (const [metricType, list] of Object.entries(byMetric)) {
    if (!isLabAnalyte(metricType)) continue
    series[metricType] = list.map((m) => ({ measuredAt: m.measuredAt, value: m.value }))
    for (const m of list) {
      results.push({
        analyteKey: metricType,
        value: m.value,
        unit: m.unit,
        measuredAt: m.measuredAt,
      })
    }
  }

  const o = args.overrides ?? {}
  let ageYears = typeof o.ageYears === 'number' && Number.isFinite(o.ageYears) ? o.ageYears : null
  let sex: LabSex | null = o.sex === 'M' || o.sex === 'F' ? o.sex : null
  const state: LabState = o.state ?? 'padrao'

  if (ageYears === null || !sex) {
    const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
    const { data } = await supabase.rpc('get_patient_for_tenant', {
      p_tenant_id: args.tenantId,
      p_patient_id: args.patientId,
      p_key: key,
    } as never)
    const p = ((data as unknown as Array<{ birth_date: string | null; sex: string | null }>) ??
      [])[0]
    if (p) {
      if (ageYears === null && p.birth_date) ageYears = ageFromBirth(p.birth_date)
      if (!sex && p.sex) sex = p.sex === 'masculino' ? 'M' : p.sex === 'feminino' ? 'F' : null
    }
  }

  // Classifica com o que houver. Sem sexo, os 16 analitos que dependem dele
  // saem como "sem referência" e o resto (69 das 85 faixas são iguais para
  // ambos) classifica normalmente — exigir o dado bloquearia tudo à toa, já que
  // em produção quase nenhum cadastro tem sexo/nascimento preenchidos.
  const ranges = await listLabRangesForPatient(supabase, { ageYears, sex, state })
  const panel = classifyLabResults(results, ranges)

  // Quantos exames JÁ LANÇADOS ficariam classificáveis se o sexo fosse
  // informado — é o que justifica pedir o dado, em vez de pedir sempre.
  let blockedBySex = 0
  if (!sex) {
    const sexDependent = await listSexDependentAnalytes(supabase)
    blockedBySex = panel.items.filter(
      (i) => i.class === 'sem_referencia' && sexDependent.has(i.analyteKey),
    ).length
  }

  return {
    patient: { ageYears, sex, state },
    panel,
    series,
    need: { age: ageYears === null, sex: !sex, blockedBySex },
  }
}

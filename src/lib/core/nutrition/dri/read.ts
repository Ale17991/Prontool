import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

/**
 * Feature 049 US2 — leitura das DRIs (recomendação de ingestão) para a faixa
 * de um paciente. Catálogo global (0182). Escolhe, por nutriente, a linha onde
 * a idade cai na faixa e o sexo bate (específico > 'any'), no estado informado
 * (fallback 'padrao').
 */

export type DriSex = 'M' | 'F'
export type DriState = 'padrao' | 'gestante' | 'lactante'

export interface DriValue {
  value: number
  unit: string
}

export async function listDRIsForPatient(
  supabase: SupabaseClient<Database>,
  args: { ageYears: number; sex: DriSex; state?: DriState },
): Promise<Map<string, DriValue>> {
  const state = args.state ?? 'padrao'
  const sb = supabase as unknown as SupabaseClient
  const { data, error } = await sb
    .from('dietary_reference_intakes')
    .select('nutrient_key, sex, age_min_years, age_max_years, state, value, unit')
    .lte('age_min_years', args.ageYears)
    .gte('age_max_years', args.ageYears)
    .in('sex', [args.sex, 'any'])
    .in('state', state === 'padrao' ? ['padrao'] : [state, 'padrao'])
  if (error) throw new Error(`listDRIsForPatient: ${error.message}`)

  const rows = (data ?? []) as Array<{
    nutrient_key: string
    sex: string
    state: string
    value: number
    unit: string
  }>

  // Por nutriente, escolhe a melhor linha: estado informado > padrao; sexo
  // específico > 'any'.
  const best = new Map<string, { row: (typeof rows)[number]; score: number }>()
  for (const r of rows) {
    const score = (r.state === state ? 2 : 0) + (r.sex === args.sex ? 1 : 0)
    const cur = best.get(r.nutrient_key)
    if (!cur || score > cur.score) best.set(r.nutrient_key, { row: r, score })
  }
  const out = new Map<string, DriValue>()
  for (const [k, { row }] of best) out.set(k, { value: Number(row.value), unit: row.unit })
  return out
}

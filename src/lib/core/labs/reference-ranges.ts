import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import type { LabRange } from './classify'

/**
 * Feature 050 US1 — leitura das faixas de referência aplicáveis a um paciente.
 *
 * Catálogo global (migration 0184). Escolhe, por analito, a linha em que a idade
 * cai na faixa e o sexo bate (específico > 'any'), no estado informado (com
 * fallback para 'padrao').
 *
 * Cópia deliberada do algoritmo de `nutrition/dri/read.ts` (049): uma query com
 * filtro amplo + desempate em memória por score, para não fazer N consultas nem
 * depender de SQL de janela.
 *
 * LIMITAÇÃO CONHECIDA: a fonte (`BD_Exames` da Evonut) recorta as faixas apenas
 * por SEXO — não há faixa etária nem estado gestacional. O seed grava tudo como
 * 0–130 / 'padrao', então na prática o v1 classifica por sexo. O eixo de idade
 * está implementado e testado: quando entrar uma fonte pediátrica ou obstétrica,
 * basta inserir linhas mais específicas, sem tocar neste código.
 */

export type LabSex = 'M' | 'F'
export type LabState = 'padrao' | 'gestante' | 'lactante'

export async function listLabRangesForPatient(
  supabase: SupabaseClient<Database>,
  args: { ageYears: number; sex: LabSex; state?: LabState },
): Promise<Map<string, LabRange>> {
  const state = args.state ?? 'padrao'
  const sb = supabase as unknown as SupabaseClient
  const { data, error } = await sb
    .from('lab_reference_ranges')
    .select('analyte_key, sex, age_min_years, age_max_years, state, ref_min, ref_max, unit, source_label')
    .lte('age_min_years', args.ageYears)
    .gte('age_max_years', args.ageYears)
    .in('sex', [args.sex, 'any'])
    .in('state', state === 'padrao' ? ['padrao'] : [state, 'padrao'])
  if (error) throw new Error(`listLabRangesForPatient: ${error.message}`)

  const rows = (data ?? []) as Array<{
    analyte_key: string
    sex: string
    state: string
    ref_min: number | null
    ref_max: number | null
    unit: string
    source_label: string | null
  }>

  // Por analito, a linha mais específica vence: estado informado (peso 2) sobre
  // 'padrao'; sexo específico (peso 1) sobre 'any'.
  const best = new Map<string, { row: (typeof rows)[number]; score: number }>()
  for (const r of rows) {
    const score = (r.state === state ? 2 : 0) + (r.sex === args.sex ? 1 : 0)
    const cur = best.get(r.analyte_key)
    if (!cur || score > cur.score) best.set(r.analyte_key, { row: r, score })
  }

  const out = new Map<string, LabRange>()
  for (const [k, { row }] of best) {
    out.set(k, {
      refMin: row.ref_min === null ? null : Number(row.ref_min),
      refMax: row.ref_max === null ? null : Number(row.ref_max),
      unit: row.unit,
      sourceLabel: row.source_label,
    })
  }
  return out
}

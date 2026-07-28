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

/**
 * Sexo e idade são OPCIONAIS de propósito. No cadastro real eles quase nunca
 * estão preenchidos (em produção: 13 de 712 pacientes com sexo, 45 com data de
 * nascimento) e o campo é opcional no formulário. Exigir os dois bloquearia a
 * classificação inteira — quando, na prática, **69 das 85 faixas são iguais
 * para ambos os sexos** e todas as faixas atuais valem de 0 a 130 anos.
 *
 * Sem sexo, devolve só as faixas `any`: os 16 analitos que dependem de sexo
 * (ferritina, hemoglobina, hematócrito, TGO/TGP…) ficam de fora e a tela os
 * mostra como "sem referência", pedindo o dado. Vale também para `intersexo`,
 * que o cadastro oferece e para o qual não existe faixa específica na fonte.
 */
export async function listLabRangesForPatient(
  supabase: SupabaseClient<Database>,
  args: { ageYears?: number | null; sex?: LabSex | null; state?: LabState },
): Promise<Map<string, LabRange>> {
  const state = args.state ?? 'padrao'
  const sex = args.sex ?? null
  const ageYears = args.ageYears ?? null
  const sb = supabase as unknown as SupabaseClient
  let q = sb
    .from('lab_reference_ranges')
    .select('analyte_key, sex, age_min_years, age_max_years, state, ref_min, ref_max, unit, source_label')
    .in('sex', sex ? [sex, 'any'] : ['any'])
    .in('state', state === 'padrao' ? ['padrao'] : [state, 'padrao'])
  // Sem idade, não filtra por faixa etária: o desempate abaixo escolhe a banda
  // mais abrangente, que é a leitura honesta de "não sei a idade".
  if (ageYears !== null) {
    q = q.lte('age_min_years', ageYears).gte('age_max_years', ageYears)
  }
  const { data, error } = await q
  if (error) throw new Error(`listLabRangesForPatient: ${error.message}`)

  const rows = (data ?? []) as Array<{
    analyte_key: string
    sex: string
    age_min_years: number
    age_max_years: number
    state: string
    ref_min: number | null
    ref_max: number | null
    unit: string
    source_label: string | null
  }>

  // Por analito, a linha mais específica vence: estado informado (peso 2) sobre
  // 'padrao'; sexo específico (peso 1) sobre 'any'. Empatou e a idade é
  // desconhecida? Fica a banda etária mais LARGA (menos específica).
  const best = new Map<string, { row: (typeof rows)[number]; score: number; span: number }>()
  for (const r of rows) {
    const score = (r.state === state ? 2 : 0) + (sex && r.sex === sex ? 1 : 0)
    const span = Number(r.age_max_years) - Number(r.age_min_years)
    const cur = best.get(r.analyte_key)
    const wins =
      !cur ||
      score > cur.score ||
      (score === cur.score && ageYears === null && span > cur.span)
    if (wins) best.set(r.analyte_key, { row: r, score, span })
  }

  return toRanges(best)
}

/**
 * Analitos cuja faixa só existe por sexo (não há linha `any`). São os únicos
 * que ficam sem classificação quando o cadastro não tem o sexo — serve para a
 * tela pedir o dado com um motivo concreto ("N exames dependem disso") em vez
 * de pedir sempre.
 */
export async function listSexDependentAnalytes(
  supabase: SupabaseClient<Database>,
): Promise<Set<string>> {
  const sb = supabase as unknown as SupabaseClient
  const { data, error } = await sb.from('lab_reference_ranges').select('analyte_key, sex')
  if (error) throw new Error(`listSexDependentAnalytes: ${error.message}`)
  const rows = (data ?? []) as Array<{ analyte_key: string; sex: string }>
  const withAny = new Set(rows.filter((r) => r.sex === 'any').map((r) => r.analyte_key))
  return new Set(rows.filter((r) => r.sex !== 'any' && !withAny.has(r.analyte_key)).map((r) => r.analyte_key))
}

function toRanges(
  best: Map<string, { row: { ref_min: number | null; ref_max: number | null; unit: string; source_label: string | null } }>,
): Map<string, LabRange> {
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

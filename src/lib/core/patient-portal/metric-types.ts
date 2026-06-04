import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

/**
 * Feature 030 — leitura tipada do catálogo `patient_metric_types`.
 *
 * O catálogo é global (sem tenant) e read-only no app: define quais
 * métricas existem, unidade, faixas plausíveis e a especialidade que as
 * agrupa (FR-015/FR-016 — endocrinologia é a primeira configuração; uma
 * nova especialidade é só seed novo, sem mudança de schema).
 */

export interface PatientMetricType {
  metricType: string
  label: string
  unit: string
  minPlausible: number
  maxPlausible: number
  specialty: string
  displayOrder: number
  active: boolean
}

interface DbRow {
  metric_type: string
  label: string
  unit: string
  min_plausible: number
  max_plausible: number
  specialty: string
  display_order: number
  active: boolean
}

const COLUMNS =
  'metric_type, label, unit, min_plausible, max_plausible, specialty, display_order, active'

function toDto(r: DbRow): PatientMetricType {
  return {
    metricType: r.metric_type,
    label: r.label,
    unit: r.unit,
    minPlausible: Number(r.min_plausible),
    maxPlausible: Number(r.max_plausible),
    specialty: r.specialty,
    displayOrder: r.display_order,
    active: r.active,
  }
}

/** Lista métricas ativas, opcionalmente por especialidade, na ordem da UI. */
export async function listMetricTypes(
  supabase: SupabaseClient<Database>,
  args: { specialty?: string } = {},
): Promise<PatientMetricType[]> {
  let query = supabase
    .from('patient_metric_types')
    .select(COLUMNS)
    .eq('active', true)
    .order('display_order', { ascending: true })
  if (args.specialty) {
    query = query.eq('specialty', args.specialty)
  }
  const { data, error } = await query
  if (error) throw new Error(`listMetricTypes failed: ${error.message}`)
  return ((data ?? []) as unknown as DbRow[]).map(toDto)
}

/** Lookup de um tipo (inclui inativos — o caller decide o que fazer). */
export async function getMetricType(
  supabase: SupabaseClient<Database>,
  metricType: string,
): Promise<PatientMetricType | null> {
  const { data, error } = await supabase
    .from('patient_metric_types')
    .select(COLUMNS)
    .eq('metric_type', metricType)
    .maybeSingle()
  if (error) throw new Error(`getMetricType failed: ${error.message}`)
  return data ? toDto(data as unknown as DbRow) : null
}

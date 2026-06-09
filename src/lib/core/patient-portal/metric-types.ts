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

/**
 * Lista as métricas que uma clínica expõe (FR-015/030 + config 0114).
 *
 * Catálogo global ativo ∖ desativadas pela clínica. Ausência de linha em
 * `tenant_patient_metric_settings` = habilitada (default "tudo ligado");
 * `enabled=false` esconde a métrica daquele tenant — no portal do paciente
 * e na tela da equipe. É a versão tenant-aware de `listMetricTypes`.
 */
export async function listEnabledMetricTypesForTenant(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  args: { specialty?: string } = {},
): Promise<PatientMetricType[]> {
  const [types, settingsRes] = await Promise.all([
    listMetricTypes(supabase, args),
    supabase
      .from('tenant_patient_metric_settings')
      .select('metric_type, enabled')
      .eq('tenant_id', tenantId),
  ])
  if (settingsRes.error) {
    throw new Error(`listEnabledMetricTypesForTenant settings: ${settingsRes.error.message}`)
  }
  const disabled = new Set(
    ((settingsRes.data ?? []) as Array<{ metric_type: string; enabled: boolean }>)
      .filter((s) => !s.enabled)
      .map((s) => s.metric_type),
  )
  return types.filter((t) => !disabled.has(t.metricType))
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

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { DomainError, NotFoundError } from '@/lib/observability/errors'
import { getMetricType, type PatientMetricType } from './metric-types'

/**
 * Feature 030 — motor de medições longitudinais (`patient_measurements`).
 *
 * - `listMeasurements`: leitura escopada (tenant+patient), agrupada por
 *   `metric_type` em ordem cronológica ascendente (pronta para gráfico).
 * - `recordMeasurement`: entrada da equipe (US2). Valida tipo+faixa contra o
 *   catálogo com mensagem clara (422, FR-013); o trigger BEFORE INSERT do
 *   banco é o backstop. Append-only — correção = nova medição (FR-012).
 */

export interface MeasurementDTO {
  id: string
  metricType: string
  value: number
  unit: string
  measuredAt: string
  notes: string | null
  createdAt: string
}

interface DbRow {
  id: string
  metric_type: string
  value: number
  unit: string
  measured_at: string
  notes: string | null
  created_at: string
}

const COLUMNS = 'id, metric_type, value, unit, measured_at, notes, created_at'

function toDto(r: DbRow): MeasurementDTO {
  return {
    id: r.id,
    metricType: r.metric_type,
    value: Number(r.value),
    unit: r.unit,
    measuredAt: r.measured_at,
    notes: r.notes,
    createdAt: r.created_at,
  }
}

/** Série por métrica, em ordem cronológica ascendente (pronta p/ recharts). */
export async function listMeasurements(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; patientId: string; limitPerMetric?: number },
): Promise<Record<string, MeasurementDTO[]>> {
  const { data, error } = await supabase
    .from('patient_measurements')
    .select(COLUMNS)
    .eq('tenant_id', args.tenantId)
    .eq('patient_id', args.patientId)
    .order('measured_at', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(2000)
  if (error) throw new Error(`listMeasurements failed: ${error.message}`)

  const grouped: Record<string, MeasurementDTO[]> = {}
  for (const row of (data ?? []) as unknown as DbRow[]) {
    const dto = toDto(row)
    ;(grouped[dto.metricType] ??= []).push(dto)
  }
  if (args.limitPerMetric) {
    for (const key of Object.keys(grouped)) {
      grouped[key] = grouped[key]!.slice(-args.limitPerMetric)
    }
  }
  return grouped
}

export interface RecordMeasurementInput {
  tenantId: string
  patientId: string
  metricType: string
  value: number
  /** Opcional — default é a unidade do catálogo. */
  unit?: string | null
  /** Data da medição (YYYY-MM-DD). */
  measuredAt: string
  notes?: string | null
  actorUserId: string
}

export async function recordMeasurement(
  supabase: SupabaseClient<Database>,
  input: RecordMeasurementInput,
): Promise<{ measurement: MeasurementDTO; metricType: PatientMetricType }> {
  const metricType = await getMetricType(supabase, input.metricType)
  if (!metricType || !metricType.active) {
    throw new DomainError(
      'METRIC_TYPE_UNKNOWN',
      `Métrica "${input.metricType}" não existe no catálogo (ou está desativada).`,
      { status: 422 },
    )
  }
  if (input.value < metricType.minPlausible || input.value > metricType.maxPlausible) {
    throw new DomainError(
      'MEASUREMENT_OUT_OF_RANGE',
      `Valor ${input.value} ${metricType.unit} fora da faixa plausível para ` +
        `${metricType.label} (${metricType.minPlausible}–${metricType.maxPlausible} ${metricType.unit}). ` +
        'Confira o valor digitado.',
      { status: 422 },
    )
  }

  // Escopo: paciente precisa pertencer ao tenant da sessão.
  const pat = await supabase
    .from('patients')
    .select('id')
    .eq('tenant_id', input.tenantId)
    .eq('id', input.patientId)
    .maybeSingle()
  if (pat.error) throw new Error(`patient lookup failed: ${pat.error.message}`)
  if (!pat.data) throw new NotFoundError('patient', input.patientId)

  const { data, error } = await supabase
    .from('patient_measurements')
    .insert({
      tenant_id: input.tenantId,
      patient_id: input.patientId,
      metric_type: input.metricType,
      value: input.value,
      unit: input.unit?.trim() || metricType.unit,
      measured_at: input.measuredAt,
      notes: input.notes?.trim() || null,
      created_by_user_id: input.actorUserId,
    } as never)
    .select(COLUMNS)
    .single()
  if (error || !data) {
    // Backstop do trigger (23514) vira 422 com a mensagem do banco.
    if (error?.message?.includes('MEASUREMENT_OUT_OF_RANGE') || error?.message?.includes('METRIC_TYPE_')) {
      throw new DomainError('MEASUREMENT_REJECTED', error.message, { status: 422 })
    }
    throw new Error(`recordMeasurement insert failed: ${error?.message}`)
  }

  // Princípio II — auditoria da escrita clínica (best-effort).
  try {
    await supabase.rpc('log_audit_event' as never, {
      p_tenant_id: input.tenantId,
      p_entity: 'patient_measurements',
      p_entity_id: (data as unknown as DbRow).id,
      p_field: 'recorded',
      p_old: null,
      p_new: `${input.metricType}=${input.value}`,
      p_reason: `actor=${input.actorUserId}`,
    } as never)
  } catch {
    // best-effort
  }

  return { measurement: toDto(data as unknown as DbRow), metricType }
}

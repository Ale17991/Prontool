import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { DomainError, NotFoundError } from '@/lib/observability/errors'
import { getMetricType, listMetricTypes, type PatientMetricType } from './metric-types'

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
  // Métrica custom (tenant_id setado) só vale para a clínica dona.
  if (metricType.tenantId !== null && metricType.tenantId !== input.tenantId) {
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
    if (
      error?.message?.includes('MEASUREMENT_OUT_OF_RANGE') ||
      error?.message?.includes('METRIC_TYPE_')
    ) {
      throw new DomainError('MEASUREMENT_REJECTED', error.message, { status: 422 })
    }
    throw new Error(`recordMeasurement insert failed: ${error?.message}`)
  }

  // Princípio II — auditoria da escrita clínica (best-effort).
  try {
    await supabase.rpc(
      'log_audit_event' as never,
      {
        p_tenant_id: input.tenantId,
        p_entity: 'patient_measurements',
        p_entity_id: (data as unknown as DbRow).id,
        p_field: 'recorded',
        p_old: null,
        p_new: `${input.metricType}=${input.value}`,
        p_reason: `actor=${input.actorUserId}`,
      } as never,
    )
  } catch {
    // best-effort
  }

  return { measurement: toDto(data as unknown as DbRow), metricType }
}

export interface BatchEntryInput {
  metricType: string
  value: number
  unit?: string | null
}

export interface RecordMeasurementsBatchInput {
  tenantId: string
  patientId: string
  /** Data única de toda a sessão (YYYY-MM-DD). */
  measuredAt: string
  /** Observação aplicada a todas as linhas da sessão. */
  notes?: string | null
  entries: BatchEntryInput[]
  actorUserId: string
}

/**
 * Feature 045+ (bioimpedância) — registra VÁRIAS medições de uma vez, com a
 * mesma `measured_at` (uma sessão de exame). Valida TODAS as entradas contra o
 * catálogo antes de inserir e grava num único INSERT — atômico: se qualquer
 * valor estiver fora da faixa plausível, nada é gravado (evita meia-sessão).
 * Append-only como `recordMeasurement`.
 */
export async function recordMeasurementsBatch(
  supabase: SupabaseClient<Database>,
  input: RecordMeasurementsBatchInput,
): Promise<{ measurements: MeasurementDTO[] }> {
  if (input.entries.length === 0) {
    throw new DomainError('MEASUREMENTS_REQUIRED', 'Informe ao menos uma medição.', { status: 400 })
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

  // Catálogo visível à clínica (globais + custom dela) indexado por metric_type.
  const catalog = new Map(
    (await listMetricTypes(supabase, { tenantId: input.tenantId })).map((t) => [t.metricType, t]),
  )

  const problems: string[] = []
  const rows = input.entries.map((e) => {
    const t = catalog.get(e.metricType)
    if (!t || !t.active) {
      problems.push(`Métrica "${e.metricType}" não existe no catálogo (ou está desativada).`)
      return null
    }
    if (!Number.isFinite(e.value)) {
      problems.push(`${t.label}: valor inválido.`)
      return null
    }
    if (e.value < t.minPlausible || e.value > t.maxPlausible) {
      problems.push(
        `${t.label}: ${e.value} ${t.unit} fora da faixa plausível ` +
          `(${t.minPlausible}–${t.maxPlausible} ${t.unit}).`,
      )
      return null
    }
    return {
      tenant_id: input.tenantId,
      patient_id: input.patientId,
      metric_type: e.metricType,
      value: e.value,
      unit: e.unit?.trim() || t.unit,
      measured_at: input.measuredAt,
      notes: input.notes?.trim() || null,
      created_by_user_id: input.actorUserId,
    }
  })

  if (problems.length > 0) {
    throw new DomainError('MEASUREMENT_OUT_OF_RANGE', problems.join(' '), { status: 422 })
  }

  const { data, error } = await supabase
    .from('patient_measurements')
    .insert(rows as never)
    .select(COLUMNS)
  if (error || !data) {
    if (error?.message?.includes('MEASUREMENT_OUT_OF_RANGE') || error?.message?.includes('METRIC_TYPE_')) {
      throw new DomainError('MEASUREMENT_REJECTED', error.message, { status: 422 })
    }
    throw new Error(`recordMeasurementsBatch insert failed: ${error?.message}`)
  }

  const measurements = (data as unknown as DbRow[]).map(toDto)

  // Auditoria da sessão (best-effort).
  try {
    await supabase.rpc(
      'log_audit_event' as never,
      {
        p_tenant_id: input.tenantId,
        p_entity: 'patient_measurements',
        p_entity_id: input.patientId,
        p_field: 'recorded_batch',
        p_old: null,
        p_new: measurements.map((m) => `${m.metricType}=${m.value}`).join(', '),
        p_reason: `actor=${input.actorUserId} measured_at=${input.measuredAt}`,
      } as never,
    )
  } catch {
    // best-effort
  }

  return { measurements }
}

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { DomainError } from '@/lib/observability/errors'

/**
 * Feature 030 — leitura tipada do catálogo `patient_metric_types`.
 *
 * O catálogo tem duas camadas (0123):
 *   - GLOBAIS (`tenant_id` NULL): seed por especialidade, imutável.
 *   - CUSTOM (`tenant_id` setado): métricas que a própria clínica cadastra.
 * Cada clínica enxerga global + as suas. `metric_type` continua único
 * globalmente — métricas custom são namespeadas (`c<tenant8>_<slug>`).
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
  /** NULL = métrica global do catálogo; setado = custom desta clínica. */
  tenantId: string | null
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
  tenant_id: string | null
}

const COLUMNS =
  'metric_type, label, unit, min_plausible, max_plausible, specialty, display_order, active, tenant_id'

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
    tenantId: r.tenant_id,
  }
}

/**
 * Lista métricas ativas, opcionalmente por especialidade, na ordem da UI.
 *
 * Escopo (0123): com `tenantId`, retorna globais + as custom DAQUELA clínica;
 * sem `tenantId`, retorna só as globais (default seguro — nunca vaza custom
 * de outra clínica). As leituras tenant-aware sempre passam `tenantId`.
 */
export async function listMetricTypes(
  supabase: SupabaseClient<Database>,
  args: { specialty?: string; tenantId?: string } = {},
): Promise<PatientMetricType[]> {
  let query = supabase
    .from('patient_metric_types')
    .select(COLUMNS)
    .eq('active', true)
    .order('display_order', { ascending: true })
  if (args.specialty) {
    query = query.eq('specialty', args.specialty)
  }
  if (args.tenantId) {
    query = query.or(`tenant_id.is.null,tenant_id.eq.${args.tenantId}`)
  } else {
    query = query.is('tenant_id', null)
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
    listMetricTypes(supabase, { ...args, tenantId }),
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

// =========================================================================
// Cadastro de métricas custom por clínica (0123)
// =========================================================================

/** Slug `[a-z0-9_]` a partir de um rótulo livre (remove acentos). */
export function slugifyMetric(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // tira acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_') // não-alfanumérico → _
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/**
 * Chave global da métrica custom: `c<8 hex do tenant>_<slug>`, ≤ 64 chars e
 * casando `^[a-z][a-z0-9_]{1,63}$`. O prefixo por tenant garante que duas
 * clínicas com o mesmo nome de métrica não colidam no PK global.
 */
export function buildCustomMetricKey(tenantId: string, slug: string): string {
  const prefix = `c${tenantId.replace(/-/g, '').slice(0, 8)}_`
  return `${prefix}${slug}`.slice(0, 64)
}

export interface CreateCustomMetricInput {
  tenantId: string
  label: string
  unit: string
  minPlausible: number
  maxPlausible: number
  /** default 'endocrino' — a primeira (e única) especialidade do portal hoje. */
  specialty?: string
  /** Posição na UI; default 100 (depois do seed global, que usa 1..N). */
  displayOrder?: number
}

/**
 * Cadastra uma métrica personalizada da clínica no catálogo (cadastro de
 * métricas). Insere com `tenant_id` setado e `active = true`. O caller é
 * responsável pelo RBAC (admin da própria clínica) e por passar o `tenantId`
 * da sessão. Nome duplicado na mesma clínica → erro de negócio (409).
 */
export async function createCustomMetricType(
  supabase: SupabaseClient<Database>,
  input: CreateCustomMetricInput,
): Promise<PatientMetricType> {
  const label = input.label.trim()
  const unit = input.unit.trim()
  const specialty = (input.specialty ?? 'endocrino').trim()

  if (label.length < 2 || label.length > 80) {
    throw new DomainError('INVALID_METRIC', 'O nome deve ter entre 2 e 80 caracteres.', { status: 422 })
  }
  if (unit.length < 1 || unit.length > 16) {
    throw new DomainError('INVALID_METRIC', 'A unidade deve ter entre 1 e 16 caracteres.', { status: 422 })
  }
  if (!/^[a-z][a-z0-9_]{1,31}$/.test(specialty)) {
    throw new DomainError('INVALID_METRIC', 'Especialidade inválida.', { status: 422 })
  }
  if (!Number.isFinite(input.minPlausible) || !Number.isFinite(input.maxPlausible)) {
    throw new DomainError('INVALID_METRIC', 'Faixa plausível inválida.', { status: 422 })
  }
  if (input.maxPlausible <= input.minPlausible) {
    throw new DomainError('INVALID_METRIC', 'O máximo plausível deve ser maior que o mínimo.', { status: 422 })
  }

  const slug = slugifyMetric(label)
  if (!slug) {
    throw new DomainError('INVALID_METRIC', 'O nome precisa conter letras ou números.', { status: 422 })
  }
  const metricType = buildCustomMetricKey(input.tenantId, slug)

  const { data, error } = await supabase
    .from('patient_metric_types')
    .insert({
      metric_type: metricType,
      label,
      unit,
      min_plausible: input.minPlausible,
      max_plausible: input.maxPlausible,
      specialty,
      display_order: input.displayOrder ?? 100,
      active: true,
      tenant_id: input.tenantId,
    } as never)
    .select(COLUMNS)
    .single()

  if (error || !data) {
    // 23505 = unique_violation no PK metric_type → mesma clínica, mesmo nome.
    if (error?.code === '23505' || error?.message?.includes('duplicate key')) {
      throw new DomainError(
        'METRIC_ALREADY_EXISTS',
        `Já existe uma métrica chamada "${label}" nesta clínica.`,
        { status: 409 },
      )
    }
    throw new Error(`createCustomMetricType failed: ${error?.message}`)
  }

  return toDto(data as unknown as DbRow)
}

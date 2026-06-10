/**
 * Feature 032/034 — metas por paciente×métrica (Dash de Metas).
 *
 * A equipe define um alvo (`target_value`) e a direção (cair/subir) por métrica.
 * `computeGoalProgress` é puro: progresso 0..1 a partir de baseline (1ª medição),
 * valor atual e alvo. RBAC garantido pelo caller (rota/RLS).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

export type GoalDirection = 'decrease' | 'increase'

export interface PatientGoal {
  id: string
  metricType: string
  direction: GoalDirection
  targetValue: number
}

export interface GoalProgress {
  current: number
  baseline: number
  target: number
  direction: GoalDirection
  /** 0..1 (1 = atingida). */
  progress: number
  achieved: boolean
  /** Quanto falta para o alvo (na unidade da métrica); 0 se atingida. */
  remaining: number
}

// Tabela nova (0120) ainda não tipada nos generated types → cliente solto.
function loose(supabase: SupabaseClient<Database>): SupabaseClient {
  return supabase as unknown as SupabaseClient
}

export async function listGoals(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  patientId: string,
): Promise<PatientGoal[]> {
  const { data, error } = await loose(supabase)
    .from('patient_metric_goals')
    .select('id, metric_type, direction, target_value')
    .eq('tenant_id', tenantId)
    .eq('patient_id', patientId)
    .eq('active', true)
  if (error) throw new Error(`listGoals: ${error.message}`)
  return ((data ?? []) as Array<{ id: string; metric_type: string; direction: GoalDirection; target_value: number }>).map(
    (r) => ({ id: r.id, metricType: r.metric_type, direction: r.direction, targetValue: Number(r.target_value) }),
  )
}

export interface SetGoalArgs {
  tenantId: string
  patientId: string
  metricType: string
  direction: GoalDirection
  targetValue: number
  actorUserId: string
}

/** Define/atualiza a meta ativa de uma métrica (desativa a anterior). */
export async function setGoal(
  supabase: SupabaseClient<Database>,
  args: SetGoalArgs,
): Promise<{ id: string }> {
  const sb = loose(supabase)
  // 1 ativa por métrica: desativa a anterior antes de inserir a nova.
  const deErr = (
    await sb
      .from('patient_metric_goals')
      .update({ active: false })
      .eq('tenant_id', args.tenantId)
      .eq('patient_id', args.patientId)
      .eq('metric_type', args.metricType)
      .eq('active', true)
  ).error
  if (deErr) throw new Error(`setGoal deactivate: ${deErr.message}`)

  const { data, error } = await sb
    .from('patient_metric_goals')
    .insert({
      tenant_id: args.tenantId,
      patient_id: args.patientId,
      metric_type: args.metricType,
      direction: args.direction,
      target_value: args.targetValue,
      active: true,
      created_by_user_id: args.actorUserId,
    })
    .select('id')
    .single()
  if (error) throw new Error(`setGoal insert: ${error.message}`)
  return { id: (data as { id: string }).id }
}

export async function deactivateGoal(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; patientId: string; metricType: string },
): Promise<void> {
  const { error } = await loose(supabase)
    .from('patient_metric_goals')
    .update({ active: false })
    .eq('tenant_id', args.tenantId)
    .eq('patient_id', args.patientId)
    .eq('metric_type', args.metricType)
    .eq('active', true)
  if (error) throw new Error(`deactivateGoal: ${error.message}`)
}

/**
 * Progresso puro de uma meta. baseline = 1ª medição; current = última.
 * decrease: progride à medida que `current` cai de baseline→target.
 * increase: progride à medida que `current` sobe de baseline→target.
 */
export function computeGoalProgress(args: {
  direction: GoalDirection
  target: number
  baseline: number
  current: number
}): GoalProgress {
  const { direction, target, baseline, current } = args
  let progress: number
  let achieved: boolean
  if (direction === 'decrease') {
    achieved = current <= target
    const span = baseline - target
    progress = span <= 0 ? (achieved ? 1 : 0) : (baseline - current) / span
  } else {
    achieved = current >= target
    const span = target - baseline
    progress = span <= 0 ? (achieved ? 1 : 0) : (current - baseline) / span
  }
  progress = Math.max(0, Math.min(1, progress))
  if (achieved) progress = 1
  const remaining =
    direction === 'decrease' ? Math.max(0, current - target) : Math.max(0, target - current)
  return { current, baseline, target, direction, progress, achieved, remaining }
}

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

export interface TreatmentPlanSummary {
  id: string
  title: string
  description: string | null
  status: 'ativo' | 'concluido' | 'cancelado'
  createdAt: string
  stepsTotal: number
  stepsPending: number
  stepsCompleted: number
  stepsCancelled: number
}

export interface ListTreatmentPlansInput {
  tenantId: string
  patientId: string
}

/**
 * Lista planos de tratamento de um paciente com contagens por status de
 * etapa. Feita em duas queries para não depender de uma VIEW — volume
 * por paciente é baixo (tipicamente <20 planos).
 */
export async function listTreatmentPlans(
  supabase: SupabaseClient<Database>,
  input: ListTreatmentPlansInput,
): Promise<TreatmentPlanSummary[]> {
  const plans = await supabase
    .from('treatment_plans')
    .select('id, title, description, status, created_at')
    .eq('tenant_id', input.tenantId)
    .eq('patient_id', input.patientId)
    .order('created_at', { ascending: false })

  if (plans.error) throw new Error(`list treatment plans: ${plans.error.message}`)
  const rows = plans.data ?? []
  if (rows.length === 0) return []

  const steps = await supabase
    .from('treatment_plan_steps')
    .select('treatment_plan_id, status')
    .eq('tenant_id', input.tenantId)
    .in(
      'treatment_plan_id',
      rows.map((r) => r.id),
    )

  if (steps.error) throw new Error(`list treatment plan steps: ${steps.error.message}`)

  const buckets = new Map<string, { total: number; pending: number; completed: number; cancelled: number }>()
  for (const s of steps.data ?? []) {
    const b = buckets.get(s.treatment_plan_id) ?? { total: 0, pending: 0, completed: 0, cancelled: 0 }
    b.total += 1
    if (s.status === 'pendente') b.pending += 1
    else if (s.status === 'concluido') b.completed += 1
    else if (s.status === 'cancelado') b.cancelled += 1
    buckets.set(s.treatment_plan_id, b)
  }

  return rows.map((r) => {
    const b = buckets.get(r.id) ?? { total: 0, pending: 0, completed: 0, cancelled: 0 }
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      status: r.status as TreatmentPlanSummary['status'],
      createdAt: r.created_at,
      stepsTotal: b.total,
      stepsPending: b.pending,
      stepsCompleted: b.completed,
      stepsCancelled: b.cancelled,
    }
  })
}

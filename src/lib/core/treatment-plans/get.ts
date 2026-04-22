import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { NotFoundError } from '@/lib/observability/errors'
import { tryResolvePrice } from '@/lib/core/pricing/resolve-price'

export interface TreatmentPlanStep {
  id: string
  title: string
  notes: string | null
  status: 'pendente' | 'concluido' | 'cancelado'
  scheduledDate: string | null
  completedAt: string | null
  createdAt: string
  procedure: {
    id: string
    tussCode: string
    displayName: string | null
    coveredByPlan: boolean
    defaultAmountCents: number | null
  }
  healthPlan: {
    id: string
    name: string
  } | null
  /**
   * Preço resolvido em tempo de leitura pela regra:
   *   1. procedure.coveredByPlan=false → particular (default_amount_cents, pode ser null)
   *   2. coberto + step/patient plan → price_versions
   *   3. coberto + sem plano → particular (default_amount_cents)
   *   4. nenhum valor encontrado → null
   */
  currentPriceCents: number | null
  priceSource: 'convenio' | 'particular' | null
  pricePlanId: string | null
}

export interface TreatmentPlanDetail {
  id: string
  patientId: string
  title: string
  description: string | null
  status: 'ativo' | 'concluido' | 'cancelado'
  createdAt: string
  steps: TreatmentPlanStep[]
}

export interface GetTreatmentPlanInput {
  tenantId: string
  planId: string
  /** Plano de saúde do paciente; usado como fallback pra resolver preço quando a etapa não define. */
  patientPlanId?: string | null
}

/**
 * Carrega um plano com todas as etapas expandindo procedure (nome + TUSS) e
 * health_plan (nome). Usa join via select embedding do PostgREST — os FKs
 * procedure_id / plan_id resolvem as relações automaticamente.
 */
export async function getTreatmentPlan(
  supabase: SupabaseClient<Database>,
  input: GetTreatmentPlanInput,
): Promise<TreatmentPlanDetail> {
  const plan = await supabase
    .from('treatment_plans')
    .select('id, patient_id, title, description, status, created_at')
    .eq('tenant_id', input.tenantId)
    .eq('id', input.planId)
    .maybeSingle()

  if (plan.error) throw new Error(`get treatment plan: ${plan.error.message}`)
  if (!plan.data) throw new NotFoundError('treatment_plan', input.planId)

  const stepsResult = await supabase
    .from('treatment_plan_steps')
    .select(
      'id, title, notes, status, scheduled_date, completed_at, created_at, ' +
        'procedures:procedure_id ( id, tuss_code, display_name, covered_by_plan, default_amount_cents ), ' +
        'health_plans:plan_id ( id, name )',
    )
    .eq('tenant_id', input.tenantId)
    .eq('treatment_plan_id', input.planId)
    .order('created_at', { ascending: true })

  if (stepsResult.error) throw new Error(`list steps: ${stepsResult.error.message}`)

  type RawStep = {
    id: string
    title: string
    notes: string | null
    status: string
    scheduled_date: string | null
    completed_at: string | null
    created_at: string
    procedures: {
      id: string
      tuss_code: string
      display_name: string | null
      covered_by_plan: boolean
      default_amount_cents: number | null
    } | null
    health_plans: { id: string; name: string } | null
  }
  const raw = (stepsResult.data ?? []) as unknown as RawStep[]

  // Regra de preço por etapa (ver jsdoc em TreatmentPlanStep). Uses tryResolvePrice
  // somente no caminho coberto-por-convênio; particular não faz round-trip SQL.
  const asOf = new Date()
  const priced = await Promise.all(
    raw.map(async (s) => {
      if (!s.procedures) {
        return { currentPriceCents: null, priceSource: null, pricePlanId: null } as const
      }
      const proc = s.procedures
      // Caso 1: procedimento particular-only.
      if (!proc.covered_by_plan) {
        return {
          currentPriceCents: proc.default_amount_cents,
          priceSource: proc.default_amount_cents !== null ? 'particular' : null,
          pricePlanId: null,
        } as const
      }
      // Caso 2: coberto + plano (step.plan_id > patient.plan_id).
      const planForPrice = s.health_plans?.id ?? input.patientPlanId ?? null
      if (planForPrice) {
        const found = await tryResolvePrice(supabase, {
          tenantId: input.tenantId,
          procedureId: proc.id,
          planId: planForPrice,
          asOf,
        })
        if (found) {
          return {
            currentPriceCents: found.amountCents,
            priceSource: 'convenio',
            pricePlanId: planForPrice,
          } as const
        }
        // Coberto + plano mas sem preço — não cai pra particular automaticamente;
        // "sem preço cadastrado" é um sinal claro pro operador.
        return {
          currentPriceCents: null,
          priceSource: null,
          pricePlanId: planForPrice,
        } as const
      }
      // Caso 3: coberto + sem plano do paciente → particular.
      return {
        currentPriceCents: proc.default_amount_cents,
        priceSource: proc.default_amount_cents !== null ? 'particular' : null,
        pricePlanId: null,
      } as const
    }),
  )

  const steps: TreatmentPlanStep[] = raw.map((s, idx) => ({
    id: s.id,
    title: s.title,
    notes: s.notes,
    status: s.status as TreatmentPlanStep['status'],
    scheduledDate: s.scheduled_date,
    completedAt: s.completed_at,
    createdAt: s.created_at,
    procedure: s.procedures
      ? {
          id: s.procedures.id,
          tussCode: s.procedures.tuss_code,
          displayName: s.procedures.display_name,
          coveredByPlan: s.procedures.covered_by_plan,
          defaultAmountCents: s.procedures.default_amount_cents,
        }
      : {
          id: '',
          tussCode: '—',
          displayName: null,
          coveredByPlan: true,
          defaultAmountCents: null,
        },
    healthPlan: s.health_plans ? { id: s.health_plans.id, name: s.health_plans.name } : null,
    currentPriceCents: priced[idx]!.currentPriceCents,
    priceSource: priced[idx]!.priceSource,
    pricePlanId: priced[idx]!.pricePlanId,
  }))

  return {
    id: plan.data.id,
    patientId: plan.data.patient_id,
    title: plan.data.title,
    description: plan.data.description,
    status: plan.data.status as TreatmentPlanDetail['status'],
    createdAt: plan.data.created_at,
    steps,
  }
}

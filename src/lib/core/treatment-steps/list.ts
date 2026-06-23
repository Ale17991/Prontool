import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { tryResolvePrice } from '@/lib/core/pricing/resolve-price'
import {
  listMaterialsByAppointmentIds,
  type AppointmentMaterial,
} from '@/lib/core/appointments/materials/list'

export interface TreatmentStep {
  id: string
  title: string
  notes: string | null
  status: 'pendente' | 'concluido' | 'cancelado'
  scheduledDate: string | null
  completedAt: string | null
  createdAt: string
  /** Posição odontológica (feature 040). Null em etapas não-odonto. */
  toothFdi: number | null
  surface: string | null
  /** Orçamento vinculado (feature 040). Null se não orçado. */
  budgetId: string | null
  /** Atendimento vinculado (feature 005). Null para etapas legadas. */
  appointmentId: string | null
  /** Materiais anexados ao atendimento da etapa (feature 007). Vazio se sem atendimento. */
  materials: AppointmentMaterial[]
  procedure: {
    id: string
    tussCode: string
    displayName: string | null
    coveredByPlan: boolean
    defaultAmountCents: number | null
  }
  doctor: {
    id: string
    fullName: string
    role: string | null
    specialty: string | null
  } | null
  healthPlan: {
    id: string
    name: string
  } | null
  /**
   * Preço resolvido em tempo de leitura seguindo:
   *   1. procedure.coveredByPlan=false → particular
   *   2. coberto + step/patient plan → price_versions
   *   3. coberto + sem plano → particular
   *   4. nada → null
   */
  currentPriceCents: number | null
  priceSource: 'convenio' | 'particular' | null
  pricePlanId: string | null
}

export interface ListTreatmentStepsInput {
  tenantId: string
  patientId: string
  patientPlanId?: string | null
}

/**
 * Lista todas as etapas de tratamento do paciente, expandindo `procedures`
 * e `health_plans` via embed do PostgREST (há FK real nessas duas relações).
 * Ordenação: pendentes com data prevista primeiro (data ascendente), depois
 * pendentes sem data, depois finalizadas por `created_at` desc.
 */
export async function listTreatmentSteps(
  supabase: SupabaseClient<Database>,
  input: ListTreatmentStepsInput,
): Promise<TreatmentStep[]> {
  const res = await supabase
    .from('treatment_plan_steps')
    .select(
      'id, title, notes, status, scheduled_date, completed_at, created_at, appointment_id, ' +
        'tooth_fdi, surface, budget_id, ' +
        'procedures:procedure_id ( id, tuss_code, display_name, covered_by_plan, default_amount_cents ), ' +
        'doctors:doctor_id ( id, full_name, role, specialty ), ' +
        'health_plans:plan_id ( id, name )',
    )
    .eq('tenant_id', input.tenantId)
    .eq('patient_id', input.patientId)
    .order('scheduled_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (res.error) throw new Error(`listTreatmentSteps failed: ${res.error.message}`)

  type RawStep = {
    id: string
    title: string
    notes: string | null
    status: string
    scheduled_date: string | null
    completed_at: string | null
    created_at: string
    appointment_id: string | null
    tooth_fdi: number | null
    surface: string | null
    budget_id: string | null
    procedures: {
      id: string
      tuss_code: string
      display_name: string | null
      covered_by_plan: boolean
      default_amount_cents: number | null
    } | null
    doctors: {
      id: string
      full_name: string
      role: string | null
      specialty: string | null
    } | null
    health_plans: { id: string; name: string } | null
  }
  const raw = (res.data ?? []) as unknown as RawStep[]

  const appointmentIds = raw
    .map((s) => s.appointment_id)
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
  const materialsByAppt = await listMaterialsByAppointmentIds(
    supabase,
    appointmentIds,
    input.tenantId,
  )

  const asOf = new Date()
  const priced = await Promise.all(
    raw.map(async (s) => {
      if (!s.procedures) {
        return { currentPriceCents: null, priceSource: null, pricePlanId: null } as const
      }
      const proc = s.procedures
      // Caso 1: particular-only
      if (!proc.covered_by_plan) {
        return {
          currentPriceCents: proc.default_amount_cents,
          priceSource: proc.default_amount_cents !== null ? 'particular' : null,
          pricePlanId: null,
        } as const
      }
      // Caso 2: coberto + plano
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
        return { currentPriceCents: null, priceSource: null, pricePlanId: planForPrice } as const
      }
      // Caso 3: coberto sem plano → particular
      return {
        currentPriceCents: proc.default_amount_cents,
        priceSource: proc.default_amount_cents !== null ? 'particular' : null,
        pricePlanId: null,
      } as const
    }),
  )

  return raw.map((s, idx) => ({
    id: s.id,
    title: s.title,
    notes: s.notes,
    status: s.status as TreatmentStep['status'],
    scheduledDate: s.scheduled_date,
    completedAt: s.completed_at,
    createdAt: s.created_at,
    appointmentId: s.appointment_id,
    toothFdi: s.tooth_fdi,
    surface: s.surface,
    budgetId: s.budget_id,
    materials: s.appointment_id ? (materialsByAppt[s.appointment_id] ?? []) : [],
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
    doctor: s.doctors
      ? {
          id: s.doctors.id,
          fullName: s.doctors.full_name,
          role: s.doctors.role,
          specialty: s.doctors.specialty,
        }
      : null,
    healthPlan: s.health_plans ? { id: s.health_plans.id, name: s.health_plans.name } : null,
    currentPriceCents: priced[idx]!.currentPriceCents,
    priceSource: priced[idx]!.priceSource,
    pricePlanId: priced[idx]!.pricePlanId,
  }))
}

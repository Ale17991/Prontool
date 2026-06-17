import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ValidationError } from '@/lib/observability/errors'

/**
 * Fontes de dados compartilhadas pelos relatórios financeiros que segregam
 * receita/comissão por profissional e por plano.
 *
 * Centraliza o acesso a:
 *   - appointments_effective (atendimentos ativos, com frozen_commission_bps)
 *   - appointment_procedures (linhas com valor + plano por linha — migration 0069)
 *   - doctors (catálogo de profissionais ativos)
 *   - health_plans.tax_rate_bps (imposto do convênio — feature 011/US4)
 *
 * Antes esses helpers eram privados em by-professional.ts; foram promovidos
 * a fonte única para que o relatório por profissional, a matriz médico×plano
 * e o repasse mensal somem exatamente os mesmos centavos (evita o drift de
 * arredondamento que a Camada 3 já teve de corrigir).
 */

export const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

export interface ActiveAppointmentRow {
  id: string
  patient_id: string
  doctor_id: string
  appointment_at: string
  effective_status: string | null
  frozen_commission_bps: number
}

export interface ProcedureLineRow {
  appointment_id: string
  procedure_id: string
  plan_id: string | null
  /** UNITARIO em cents. */
  line_amount_cents: number
  /** Multiplicador (default 1). Migration 0081. */
  quantity: number
  procedures: { id: string; tuss_code: string; display_name: string | null } | null
  health_plans: { id: string; name: string } | null
}

export interface ReportDoctorRow {
  id: string
  full_name: string
  role: string | null
  specialty: string | null
  council_name: string | null
  council_number: string | null
  crm: string | null
  active: boolean
}

export function validateReportPeriod(from: string, to: string): void {
  if (!DATE_REGEX.test(from) || !DATE_REGEX.test(to)) {
    throw new ValidationError('Parâmetros from/to devem estar no formato YYYY-MM-DD')
  }
  if (from > to) {
    throw new ValidationError('Parâmetro `from` não pode ser posterior a `to`')
  }
}

export async function fetchActiveAppointments(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  fromTs: string,
  toExclusive: string,
): Promise<ActiveAppointmentRow[]> {
  const PAGE_SIZE = 1000
  const rows: ActiveAppointmentRow[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('appointments_effective')
      .select(
        'id, patient_id, doctor_id, appointment_at, effective_status, frozen_commission_bps',
      )
      .eq('tenant_id', tenantId)
      .gte('appointment_at', fromTs)
      .lt('appointment_at', toExclusive)
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) throw new Error(`fetchActiveAppointments failed: ${error.message}`)
    const page = (data ?? []) as unknown as ActiveAppointmentRow[]
    for (const r of page) {
      if (r.effective_status === 'ativo') rows.push(r)
    }
    if (page.length < PAGE_SIZE) break
  }
  return rows
}

export async function fetchProcedureLines(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  appointmentIds: string[],
): Promise<ProcedureLineRow[]> {
  if (appointmentIds.length === 0) return []
  const PAGE_SIZE = 1000
  const CHUNK = 500
  const all: ProcedureLineRow[] = []
  for (let i = 0; i < appointmentIds.length; i += CHUNK) {
    const ids = appointmentIds.slice(i, i + CHUNK)
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await supabase
        .from('appointment_procedures' as never)
        .select(
          'appointment_id, procedure_id, plan_id, line_amount_cents, quantity, ' +
            'procedures:procedure_id(id, tuss_code, display_name), health_plans:plan_id(id, name)',
        )
        .eq('tenant_id', tenantId)
        .in('appointment_id', ids)
        .range(offset, offset + PAGE_SIZE - 1)
      if (error) {
        if (/relation .*appointment_procedures.* does not exist/i.test(error.message)) {
          return []
        }
        throw new Error(`fetchProcedureLines failed: ${error.message}`)
      }
      const page = (data ?? []) as unknown as ProcedureLineRow[]
      all.push(...page)
      if (page.length < PAGE_SIZE) break
    }
  }
  return all
}

export async function fetchAllReportDoctors(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<ReportDoctorRow[]> {
  const { data, error } = await supabase
    .from('doctors')
    .select('id, full_name, role, specialty, council_name, council_number, crm, active')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .order('full_name', { ascending: true })
  if (error) throw new Error(`fetchAllReportDoctors failed: ${error.message}`)
  return (data ?? []) as unknown as ReportDoctorRow[]
}

/**
 * Lê `tax_rate_bps` (imposto do convênio) por plano. Planos sem taxa
 * configurada retornam 0. Particular (plan_id null) nunca tem entrada.
 */
export async function fetchPlanTaxRates(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  planIds: string[],
): Promise<Map<string, number>> {
  if (planIds.length === 0) return new Map()
  const { data, error } = await supabase
    .from('health_plans')
    .select('id, tax_rate_bps')
    .eq('tenant_id', tenantId)
    .in('id', planIds)
  if (error) throw new Error(`fetchPlanTaxRates failed: ${error.message}`)
  const map = new Map<string, number>()
  for (const row of (data ?? []) as Array<{ id: string; tax_rate_bps?: number }>) {
    map.set(row.id, row.tax_rate_bps ?? 0)
  }
  return map
}

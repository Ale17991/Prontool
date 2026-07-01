import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { getTenantTimezone, ymdStartOfDayUtc, ymdNextDayStartUtc } from '@/lib/utils/tenant-tz'
import {
  fetchActiveAppointments,
  fetchProcedureLines,
  fetchAllReportDoctors,
  fetchPlanTaxRates,
  validateReportPeriod,
  type ActiveAppointmentRow,
  type ProcedureLineRow,
  type ReportDoctorRow,
} from './_sources'

/**
 * Matriz médico × plano — fonte única de segregação de receita/comissão por
 * profissional E por convênio simultaneamente.
 *
 * Cada célula representa o que UM médico produziu dentro de UM plano no
 * período: bruto, comissão (frozen_commission_bps por linha), imposto do
 * convênio (tax_rate_bps) e líquido. Os relatórios por-profissional,
 * médico×plano e o repasse mensal derivam todos desta agregação para somar
 * exatamente os mesmos centavos.
 *
 * Decisão de arredondamento: imposto e comissão são arredondados POR CÉLULA
 * (Math.round), não no total do plano. Isso atribui o centavo ao par
 * médico×plano correto; como efeito, somar o imposto das células de um plano
 * pode divergir em ±1 centavo do imposto plano-nível do relatório "por plano"
 * (que arredonda uma vez sobre o bruto agregado). É o trade-off correto para
 * rastreabilidade por profissional.
 */

/** Sentinela para atendimento particular (sem plano). */
export const PARTICULAR_PLAN_ID = ''
export const PARTICULAR_PLAN_NAME = 'Particular'

export interface DoctorPlanCell {
  doctorId: string
  doctorName: string
  /** '' = particular (sem convênio). */
  planId: string
  planName: string
  procedureCount: number
  grossCents: number
  commissionCents: number
  taxRateBps: number
  taxFromPlanCents: number
  /** grossCents − taxFromPlanCents. */
  netOfTaxCents: number
}

export interface DoctorPlanBreakdown {
  planId: string
  planName: string
  procedureCount: number
  grossCents: number
  commissionCents: number
  taxFromPlanCents: number
  netOfTaxCents: number
}

export interface DoctorRollup {
  doctorId: string
  doctorName: string
  procedureCount: number
  grossCents: number
  commissionCents: number
  taxFromPlanCents: number
  netOfTaxCents: number
  byPlan: DoctorPlanBreakdown[]
}

export interface PlanRollup {
  planId: string
  planName: string
  procedureCount: number
  grossCents: number
  commissionCents: number
  taxFromPlanCents: number
  netOfTaxCents: number
}

export interface DoctorPlanMatrix {
  cells: DoctorPlanCell[]
  byDoctor: DoctorRollup[]
  byPlan: PlanRollup[]
  totals: {
    procedureCount: number
    grossCents: number
    commissionCents: number
    taxFromPlanCents: number
    netOfTaxCents: number
  }
}

interface AggregateInput {
  appointments: ActiveAppointmentRow[]
  lines: ProcedureLineRow[]
  /** Mapa doctor_id → nome para rotular as células. */
  doctorNameById: Map<string, string>
  /** Mapa plan_id → tax_rate_bps (particular não tem entrada → 0). */
  planTaxMap: Map<string, number>
}

const INACTIVE_DOCTOR_LABEL = 'Profissional inativo'

/**
 * Agregação pura — sem I/O. Recebe atendimentos ativos, linhas de
 * procedimento e os mapas de apoio; devolve a matriz completa.
 */
export function aggregateDoctorPlanMatrix(input: AggregateInput): DoctorPlanMatrix {
  const { appointments, lines, doctorNameById, planTaxMap } = input

  const apptById = new Map<string, ActiveAppointmentRow>()
  for (const a of appointments) apptById.set(a.id, a)

  // Acumula por chave composta doctorId|planId.
  const cellMap = new Map<string, DoctorPlanCell>()

  for (const l of lines) {
    const appt = apptById.get(l.appointment_id)
    if (!appt) continue
    const doctorId = appt.doctor_id
    const planId = l.plan_id ?? PARTICULAR_PLAN_ID
    const planName =
      l.plan_id === null ? PARTICULAR_PLAN_NAME : (l.health_plans?.name ?? 'Convênio')

    const qty = l.quantity || 1
    const lineTotal = l.line_amount_cents * qty
    // Comissão por linha com o bps congelado no atendimento (Math.round
    // padronizado — idêntico a by-professional.ts).
    const commission = Math.round((lineTotal * appt.frozen_commission_bps) / 10000)

    const cellKey = `${doctorId}|${planId}`
    const cell = cellMap.get(cellKey) ?? {
      doctorId,
      doctorName: doctorNameById.get(doctorId) ?? INACTIVE_DOCTOR_LABEL,
      planId,
      planName,
      procedureCount: 0,
      grossCents: 0,
      commissionCents: 0,
      taxRateBps: planTaxMap.get(planId) ?? 0,
      taxFromPlanCents: 0,
      netOfTaxCents: 0,
    }
    cell.procedureCount += qty
    cell.grossCents += lineTotal
    cell.commissionCents += commission
    cellMap.set(cellKey, cell)
  }

  // Imposto do convênio aplicado sobre o bruto acumulado da célula.
  const cells = Array.from(cellMap.values())
  for (const cell of cells) {
    cell.taxFromPlanCents = Math.round((cell.grossCents * cell.taxRateBps) / 10000)
    cell.netOfTaxCents = cell.grossCents - cell.taxFromPlanCents
  }

  return {
    cells: cells.sort(cellSort),
    byDoctor: rollupByDoctor(cells),
    byPlan: rollupByPlan(cells),
    totals: sumTotals(cells),
  }
}

function cellSort(a: DoctorPlanCell, b: DoctorPlanCell): number {
  if (b.grossCents !== a.grossCents) return b.grossCents - a.grossCents
  const n = a.doctorName.localeCompare(b.doctorName, 'pt-BR')
  if (n !== 0) return n
  return a.planName.localeCompare(b.planName, 'pt-BR')
}

export function rollupByDoctor(cells: DoctorPlanCell[]): DoctorRollup[] {
  const map = new Map<string, DoctorRollup>()
  for (const c of cells) {
    const r = map.get(c.doctorId) ?? {
      doctorId: c.doctorId,
      doctorName: c.doctorName,
      procedureCount: 0,
      grossCents: 0,
      commissionCents: 0,
      taxFromPlanCents: 0,
      netOfTaxCents: 0,
      byPlan: [],
    }
    r.procedureCount += c.procedureCount
    r.grossCents += c.grossCents
    r.commissionCents += c.commissionCents
    r.taxFromPlanCents += c.taxFromPlanCents
    r.netOfTaxCents += c.netOfTaxCents
    r.byPlan.push({
      planId: c.planId,
      planName: c.planName,
      procedureCount: c.procedureCount,
      grossCents: c.grossCents,
      commissionCents: c.commissionCents,
      taxFromPlanCents: c.taxFromPlanCents,
      netOfTaxCents: c.netOfTaxCents,
    })
    map.set(c.doctorId, r)
  }
  for (const r of map.values()) {
    r.byPlan.sort((a, b) => b.grossCents - a.grossCents)
  }
  return Array.from(map.values()).sort(
    (a, b) => b.grossCents - a.grossCents || a.doctorName.localeCompare(b.doctorName, 'pt-BR'),
  )
}

export function rollupByPlan(cells: DoctorPlanCell[]): PlanRollup[] {
  const map = new Map<string, PlanRollup>()
  for (const c of cells) {
    const r = map.get(c.planId) ?? {
      planId: c.planId,
      planName: c.planName,
      procedureCount: 0,
      grossCents: 0,
      commissionCents: 0,
      taxFromPlanCents: 0,
      netOfTaxCents: 0,
    }
    r.procedureCount += c.procedureCount
    r.grossCents += c.grossCents
    r.commissionCents += c.commissionCents
    r.taxFromPlanCents += c.taxFromPlanCents
    r.netOfTaxCents += c.netOfTaxCents
    map.set(c.planId, r)
  }
  return Array.from(map.values()).sort(
    (a, b) => b.grossCents - a.grossCents || a.planName.localeCompare(b.planName, 'pt-BR'),
  )
}

function sumTotals(cells: DoctorPlanCell[]): DoctorPlanMatrix['totals'] {
  return cells.reduce(
    (acc, c) => {
      acc.procedureCount += c.procedureCount
      acc.grossCents += c.grossCents
      acc.commissionCents += c.commissionCents
      acc.taxFromPlanCents += c.taxFromPlanCents
      acc.netOfTaxCents += c.netOfTaxCents
      return acc
    },
    {
      procedureCount: 0,
      grossCents: 0,
      commissionCents: 0,
      taxFromPlanCents: 0,
      netOfTaxCents: 0,
    },
  )
}

/**
 * Builder assíncrono — faz o I/O (fuso, atendimentos, linhas, médicos,
 * impostos) e delega para a agregação pura.
 */
export async function buildDoctorPlanMatrix(
  supabase: SupabaseClient<Database>,
  input: { tenantId: string; from: string; to: string },
): Promise<DoctorPlanMatrix> {
  validateReportPeriod(input.from, input.to)

  const tz = await getTenantTimezone(supabase, input.tenantId)
  const fromTs = ymdStartOfDayUtc(input.from, tz)
  const toExclusive = ymdNextDayStartUtc(input.to, tz)

  const [appointments, doctors] = await Promise.all([
    fetchActiveAppointments(supabase, input.tenantId, fromTs, toExclusive),
    fetchAllReportDoctors(supabase, input.tenantId),
  ])

  const doctorNameById = new Map<string, string>()
  for (const d of doctors) doctorNameById.set(d.id, d.full_name)

  if (appointments.length === 0) {
    return aggregateDoctorPlanMatrix({
      appointments: [],
      lines: [],
      doctorNameById,
      planTaxMap: new Map(),
    })
  }

  const lines = await fetchProcedureLines(
    supabase,
    input.tenantId,
    appointments.map((a) => a.id),
  )

  const planIds = Array.from(
    new Set(
      lines
        .map((l) => l.plan_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  )
  const planTaxMap = await fetchPlanTaxRates(supabase, input.tenantId, planIds)

  return aggregateDoctorPlanMatrix({ appointments, lines, doctorNameById, planTaxMap })
}

export type { ReportDoctorRow }

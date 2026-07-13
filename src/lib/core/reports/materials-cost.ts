import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

/**
 * Feature 045 US2/US3 — agregação do "Gasto com materiais".
 *
 * O custo é o snapshot congelado em `appointment_materials.unit_cost_cents`
 * (× quantity). A janela é definida por `appointment_at` (fuso do tenant,
 * já resolvido pelo caller em ISO UTC). Atendimentos ESTORNADOS são
 * excluídos — o material de um atendimento cancelado não é gasto do mês.
 *
 * Decisão D1: este valor NÃO toca receita, comissão nem repasse. É apenas
 * uma dedução de resultado (margem da clínica).
 */

export interface MaterialsCostWindow {
  tenantId: string
  /** ISO UTC inclusivo (meia-noite do 1º dia no fuso do tenant). */
  fromIso: string
  /** ISO UTC exclusivo (meia-noite do 1º dia do mês seguinte). */
  toIso: string
}

interface MaterialCostRow {
  unit_cost_cents: number | null
  quantity: number | null
  appointment_id: string
  material_name: string | null
  tuss_description: string | null
  tuss_code: string | null
}

function isMissingTable(message: string): boolean {
  return /relation .*appointment_materials.* does not exist/i.test(message)
}

/** Divide um array em blocos de tamanho `size` (para `.in()` seguro na URL). */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/**
 * IDs de atendimentos ATIVOS (não estornados) na janela. Base compartilhada
 * por todas as agregações — garante consistência com o resultado operacional.
 */
async function activeAppointmentIds(
  supabase: SupabaseClient<Database>,
  w: MaterialsCostWindow,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('appointments_effective')
    .select('id, effective_status, appointment_at')
    .eq('tenant_id', w.tenantId)
    .gte('appointment_at', w.fromIso)
    .lt('appointment_at', w.toIso)
  if (error) throw new Error(`materials-cost appointments_effective: ${error.message}`)
  return ((data ?? []) as Array<{ id: string; effective_status: string | null }>)
    .filter((r) => r.effective_status !== 'estornado')
    .map((r) => r.id)
}

/** Carrega as linhas de material dos atendimentos informados (com chunking). */
async function loadMaterialRows(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  appointmentIds: string[],
): Promise<MaterialCostRow[]> {
  if (appointmentIds.length === 0) return []
  const rows: MaterialCostRow[] = []
  for (const ids of chunk(appointmentIds, 500)) {
    const { data, error } = await supabase
      .from('appointment_materials' as never)
      .select('unit_cost_cents, quantity, appointment_id, material_name, tuss_description, tuss_code')
      .eq('tenant_id', tenantId)
      .in('appointment_id', ids)
    if (error) {
      if (isMissingTable(error.message)) return []
      throw new Error(`materials-cost appointment_materials: ${error.message}`)
    }
    rows.push(...((data ?? []) as unknown as MaterialCostRow[]))
  }
  return rows
}

function rowCost(r: MaterialCostRow): number {
  return (r.unit_cost_cents ?? 0) * (r.quantity ?? 0)
}

/** Soma total do gasto com materiais na janela (estornados excluídos). */
export async function sumMaterialsCost(
  supabase: SupabaseClient<Database>,
  w: MaterialsCostWindow,
): Promise<number> {
  const ids = await activeAppointmentIds(supabase, w)
  const rows = await loadMaterialRows(supabase, w.tenantId, ids)
  return rows.reduce((s, r) => s + rowCost(r), 0)
}

export interface MaterialsCostDetailItem {
  name: string
  quantity: number
  totalCostCents: number
}

/** Detalhamento por insumo (para o drilldown de "Gasto com materiais"). */
export async function materialsCostDetail(
  supabase: SupabaseClient<Database>,
  w: MaterialsCostWindow,
): Promise<{ totalCents: number; items: MaterialsCostDetailItem[] }> {
  const ids = await activeAppointmentIds(supabase, w)
  const rows = await loadMaterialRows(supabase, w.tenantId, ids)
  const byName = new Map<string, MaterialsCostDetailItem>()
  let totalCents = 0
  for (const r of rows) {
    const name = r.material_name || r.tuss_description || r.tuss_code || '—'
    const cost = rowCost(r)
    totalCents += cost
    const cur = byName.get(name) ?? { name, quantity: 0, totalCostCents: 0 }
    cur.quantity += r.quantity ?? 0
    cur.totalCostCents += cost
    byName.set(name, cur)
  }
  const items = Array.from(byName.values()).sort((a, b) => b.totalCostCents - a.totalCostCents)
  return { totalCents, items }
}

/**
 * US3 — gasto de materiais atribuído por profissional (doctor_id do
 * atendimento). Retorna um mapa doctorId → cents.
 */
export async function materialsCostByDoctor(
  supabase: SupabaseClient<Database>,
  w: MaterialsCostWindow,
): Promise<Map<string, number>> {
  return groupByAppointmentDimension(supabase, w, 'doctor_id')
}

/** US3 — gasto de materiais atribuído por convênio (plan_id do atendimento). */
export async function materialsCostByPlan(
  supabase: SupabaseClient<Database>,
  w: MaterialsCostWindow,
): Promise<Map<string, number>> {
  return groupByAppointmentDimension(supabase, w, 'plan_id')
}

/**
 * Agrupa o gasto de materiais por uma dimensão do atendimento
 * (`doctor_id` ou `plan_id`). `plan_id` nulo (particular) é agrupado sob a
 * chave especial `__particular__`.
 */
async function groupByAppointmentDimension(
  supabase: SupabaseClient<Database>,
  w: MaterialsCostWindow,
  dimension: 'doctor_id' | 'plan_id',
): Promise<Map<string, number>> {
  const { data: apptRows, error } = await supabase
    .from('appointments_effective')
    .select(`id, effective_status, appointment_at, ${dimension}`)
    .eq('tenant_id', w.tenantId)
    .gte('appointment_at', w.fromIso)
    .lt('appointment_at', w.toIso)
  if (error) throw new Error(`materials-cost group appointments_effective: ${error.message}`)
  const dimByAppt = new Map<string, string>()
  const ids: string[] = []
  for (const r of (apptRows ?? []) as Array<Record<string, unknown>>) {
    if ((r.effective_status as string | null) === 'estornado') continue
    const id = r.id as string
    const key = (r[dimension] as string | null) ?? '__particular__'
    dimByAppt.set(id, key)
    ids.push(id)
  }
  const rows = await loadMaterialRows(supabase, w.tenantId, ids)
  const out = new Map<string, number>()
  for (const r of rows) {
    const key = dimByAppt.get(r.appointment_id)
    if (!key) continue
    out.set(key, (out.get(key) ?? 0) + rowCost(r))
  }
  return out
}

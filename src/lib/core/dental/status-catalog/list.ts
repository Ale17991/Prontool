import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

export type DentalStatusScope = 'tooth' | 'face' | 'both'

export interface DentalStatusDTO {
  id: string
  code: string
  label: string
  color: string
  icon: string | null
  scope: DentalStatusScope
  tussCodeId: string | null
  sortOrder: number
  isActive: boolean
  isSystem: boolean
  createdAt: string
  updatedAt: string
}

export interface DentalStatusRow {
  id: string
  code: string
  label: string
  color: string
  icon: string | null
  scope: string
  tuss_code_id: string | null
  sort_order: number
  is_active: boolean
  is_system: boolean
  created_at: string
  updated_at: string
}

export const DENTAL_STATUS_COLUMNS =
  'id, code, label, color, icon, scope, tuss_code_id, sort_order, is_active, is_system, created_at, updated_at'

export function mapDentalStatusRow(r: unknown): DentalStatusDTO {
  const row = r as DentalStatusRow
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    color: row.color,
    icon: row.icon,
    scope: row.scope as DentalStatusScope,
    tussCodeId: row.tuss_code_id,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    isSystem: row.is_system,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** Status ativos, ordenados para a paleta (FR-012). */
export async function listActiveStatuses(
  supabase: SupabaseClient<Database>,
): Promise<DentalStatusDTO[]> {
  const { data, error } = await supabase
    .from('dental_status_catalog')
    .select(DENTAL_STATUS_COLUMNS)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
  if (error) throw new Error(`listActiveStatuses failed: ${error.message}`)
  return ((data ?? []) as unknown[]).map(mapDentalStatusRow)
}

/** Todos os status (ativos + inativos) — gestão no /admin (US2). */
export async function listAllStatuses(
  supabase: SupabaseClient<Database>,
): Promise<DentalStatusDTO[]> {
  const { data, error } = await supabase
    .from('dental_status_catalog')
    .select(DENTAL_STATUS_COLUMNS)
    .order('sort_order', { ascending: true })
  if (error) throw new Error(`listAllStatuses failed: ${error.message}`)
  return ((data ?? []) as unknown[]).map(mapDentalStatusRow)
}

/**
 * Status por ids — usado para resolver metadados de status referenciados pelo
 * estado atual mas que já foram desativados (FR-013), garantindo cor/rótulo no
 * render mesmo fora da paleta.
 */
export async function listStatusesByIds(
  supabase: SupabaseClient<Database>,
  ids: string[],
): Promise<DentalStatusDTO[]> {
  if (ids.length === 0) return []
  const { data, error } = await supabase
    .from('dental_status_catalog')
    .select(DENTAL_STATUS_COLUMNS)
    .in('id', ids)
  if (error) throw new Error(`listStatusesByIds failed: ${error.message}`)
  return ((data ?? []) as unknown[]).map(mapDentalStatusRow)
}

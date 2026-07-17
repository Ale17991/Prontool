import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

/**
 * Material registrado em um atendimento. Imutavel apos criacao
 * (Principio I — append-only via trigger), EXCETO o custo, que pode ser
 * completado/corrigido via `setAppointmentMaterialCost` (column-guard).
 *
 * Feature 045: acrescenta custo (snapshot congelado), proveniência de
 * catálogo e insumo livre (tuss opcional).
 */
export interface AppointmentMaterial {
  id: string
  /** Nome de exibição: material_name → tuss_description → tuss_code → '—'. */
  name: string
  tussCode: string
  tussDescription: string
  materialId: string | null
  quantity: number
  unitCostCents: number
  totalCostCents: number
  /** true quando o custo ainda não foi informado (unit_cost_cents = 0). */
  costPending: boolean
  createdAt: string
  createdBy: string
}

const SELECT =
  'id, tuss_code, tuss_description, material_id, material_name, quantity, unit_cost_cents, created_at, created_by'

/** Mapeia uma linha de appointment_materials para o DTO (reusado por attach). */
export function mapAppointmentMaterialRow(r: Record<string, unknown>): AppointmentMaterial {
  const tussCode = (r.tuss_code as string | null) ?? ''
  const tussDescription = (r.tuss_description as string | null) ?? ''
  const materialName = (r.material_name as string | null) ?? ''
  const quantity = r.quantity as number
  const unitCostCents = (r.unit_cost_cents as number | null) ?? 0
  return {
    id: r.id as string,
    name: materialName || tussDescription || tussCode || '—',
    tussCode,
    tussDescription,
    materialId: (r.material_id as string | null) ?? null,
    quantity,
    unitCostCents,
    totalCostCents: unitCostCents * quantity,
    costPending: unitCostCents === 0,
    createdAt: r.created_at as string,
    createdBy: r.created_by as string,
  }
}

export interface ListMaterialsInput {
  appointmentId: string
  /**
   * Tenant da sessão. OBRIGATÓRIO mesmo com RLS — se o caller passar um
   * service-role client (que bypassa RLS), o filtro explícito de tenant_id
   * impede vazamento cross-tenant. Auditoria de segurança 2026-05-11.
   */
  tenantId: string
}

export async function listAppointmentMaterials(
  supabase: SupabaseClient<Database>,
  input: ListMaterialsInput,
): Promise<AppointmentMaterial[]> {
  const { data, error } = await supabase
    .from('appointment_materials' as never)
    .select(SELECT)
    .eq('appointment_id', input.appointmentId)
    .eq('tenant_id', input.tenantId)
    .order('created_at', { ascending: true })

  if (error) {
    // Em ambientes onde a migration 0061 ainda nao aplicou, devolvemos
    // lista vazia — o card de materiais simplesmente nao renderiza.
    if (/relation .*appointment_materials.* does not exist/i.test(error.message)) {
      return []
    }
    throw new Error(`listAppointmentMaterials failed: ${error.message}`)
  }

  return ((data ?? []) as Array<Record<string, unknown>>).map(mapAppointmentMaterialRow)
}

/**
 * Agrega materiais por appointment_id. Util para listas (timeline,
 * lote de atendimentos no PDF).
 */
export async function listMaterialsByAppointmentIds(
  supabase: SupabaseClient<Database>,
  appointmentIds: string[],
  tenantId: string,
): Promise<Record<string, AppointmentMaterial[]>> {
  if (appointmentIds.length === 0) return {}

  const { data, error } = await supabase
    .from('appointment_materials' as never)
    .select(`appointment_id, ${SELECT}`)
    .in('appointment_id', appointmentIds)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true })

  if (error) {
    if (/relation .*appointment_materials.* does not exist/i.test(error.message)) {
      return {}
    }
    throw new Error(`listMaterialsByAppointmentIds failed: ${error.message}`)
  }

  const grouped: Record<string, AppointmentMaterial[]> = {}
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    const aid = r.appointment_id as string
    if (!grouped[aid]) grouped[aid] = []
    grouped[aid].push(mapAppointmentMaterialRow(r))
  }
  return grouped
}

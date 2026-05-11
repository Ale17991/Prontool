import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

/**
 * Material registrado em um atendimento. Imutavel apos criacao
 * (Principio I — append-only via trigger). Snapshot do catalogo TUSS
 * tabela 19 no momento da insercao.
 */
export interface AppointmentMaterial {
  id: string
  tussCode: string
  tussDescription: string
  quantity: number
  createdAt: string
  createdBy: string
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
    .select('id, tuss_code, tuss_description, quantity, created_at, created_by')
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

  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    tussCode: r.tuss_code as string,
    tussDescription: r.tuss_description as string,
    quantity: r.quantity as number,
    createdAt: r.created_at as string,
    createdBy: r.created_by as string,
  }))
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
    .select('id, appointment_id, tuss_code, tuss_description, quantity, created_at, created_by')
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
    grouped[aid].push({
      id: r.id as string,
      tussCode: r.tuss_code as string,
      tussDescription: r.tuss_description as string,
      quantity: r.quantity as number,
      createdAt: r.created_at as string,
      createdBy: r.created_by as string,
    })
  }
  return grouped
}

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ConflictError, DomainError, NotFoundError } from '@/lib/observability/errors'
import { mapAppointmentMaterialRow, type AppointmentMaterial } from './list'

/**
 * Feature 045: material pode vir do catálogo (`materialId`) ou ser livre
 * (`materialName`), com ou sem TUSS. `unitCostCents` é o snapshot de custo
 * (0 = pendência). Pelo menos um identificador deve ser informado.
 */
export interface MaterialInput {
  tussCode?: string | null
  tussDescription?: string | null
  materialId?: string | null
  materialName?: string | null
  quantity: number
  unitCostCents?: number
}

export interface AttachMaterialsInput {
  appointmentId: string
  /**
   * Tenant da sessão. OBRIGATÓRIO — a RPC `attach_materials_to_appointment`
   * só valida tenant quando `jwt_tenant_id()` está populado, o que NÃO é o
   * caso sob service-role. Sem este check no app layer, um usuário
   * autenticado conseguia anexar materiais a appointments de outro tenant.
   * Auditoria de segurança 2026-05-11.
   */
  tenantId: string
  actorUserId: string
  materials: MaterialInput[]
}

export interface AttachMaterialsResult {
  appointmentId: string
  materials: AppointmentMaterial[]
}

/**
 * Anexa materiais a um atendimento existente via RPC. A RPC valida
 * tenant scoping, rejeita atendimento cancelado, e os triggers da
 * tabela rejeitam codigos TUSS fora da tabela 19.
 *
 * Mapeia mensagens de erro do RPC para DomainError tipados.
 */
export async function attachMaterialsToAppointment(
  supabase: SupabaseClient<Database>,
  input: AttachMaterialsInput,
): Promise<AttachMaterialsResult> {
  if (input.materials.length === 0) {
    throw new DomainError('MATERIALS_REQUIRED', 'Nenhum material informado.', { status: 400 })
  }

  // Pre-flight tenant check: a RPC só valida tenant quando jwt_tenant_id()
  // está populado (não está sob service-role). Validamos no app layer
  // confirmando que o appointment existe DENTRO do tenant da sessão antes
  // de chamar a RPC. Se não existir aqui, devolvemos 404 sem disclosurar
  // que ele pode existir em outro tenant.
  const { data: appt, error: apptErr } = await supabase
    .from('appointments')
    .select('id')
    .eq('id', input.appointmentId)
    .eq('tenant_id', input.tenantId)
    .maybeSingle()
  if (apptErr) {
    throw new Error(`attachMaterialsToAppointment tenant precheck failed: ${apptErr.message}`)
  }
  if (!appt) {
    throw new NotFoundError('appointments', input.appointmentId)
  }

  const payload = input.materials.map((m) => ({
    tuss_code: m.tussCode ?? null,
    tuss_description: m.tussDescription ?? null,
    material_id: m.materialId ?? null,
    material_name: m.materialName ?? null,
    quantity: m.quantity,
    unit_cost_cents: m.unitCostCents ?? 0,
  }))

  const { data, error } = await supabase.rpc(
    'attach_materials_to_appointment' as never,
    {
      p_appointment_id: input.appointmentId,
      p_materials: payload,
      p_actor: input.actorUserId,
    } as never,
  )

  if (error) {
    const msg = error.message ?? ''
    if (/APPOINTMENT_NOT_FOUND/.test(msg)) {
      throw new NotFoundError('appointments', input.appointmentId)
    }
    if (/APPOINTMENT_REVERSED/.test(msg)) {
      throw new ConflictError(
        'APPOINTMENT_REVERSED',
        'Atendimento já cancelado — não aceita novos materiais.',
      )
    }
    if (/MATERIAL_TUSS_INVALID/.test(msg)) {
      throw new DomainError(
        'MATERIAL_TUSS_INVALID',
        'Código TUSS não pertence à tabela de materiais ou não está vigente.',
        { status: 400 },
      )
    }
    if (/MATERIAL_TENANT_MISMATCH/.test(msg)) {
      throw new DomainError('MATERIAL_TENANT_MISMATCH', 'Inconsistência de clínica.', {
        status: 400,
      })
    }
    if (/quantity/i.test(msg) && /check/i.test(msg)) {
      throw new DomainError(
        'MATERIAL_QUANTITY_INVALID',
        'Quantidade deve ser um número inteiro maior que zero.',
        { status: 400 },
      )
    }
    throw new Error(`attachMaterialsToAppointment failed: ${msg}`)
  }

  const result = data as {
    appointment_id: string
    materials: Array<Record<string, unknown>>
  } | null
  const items = (result?.materials ?? []).map((r) => mapAppointmentMaterialRow(r))

  return {
    appointmentId: result?.appointment_id ?? input.appointmentId,
    materials: items,
  }
}

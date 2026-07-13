import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { NotFoundError, ValidationError } from '@/lib/observability/errors'

/**
 * Feature 045 — completa/corrige o custo de um material já lançado.
 *
 * Caminho de "column-guard": a RPC `set_appointment_material_cost`
 * (SECURITY DEFINER, auditada) atualiza SOMENTE `unit_cost_cents` (e,
 * opcionalmente, `material_id`); o trigger append-only rejeita qualquer
 * outra coluna. `reason` é obrigatório (Princípio II — auditoria).
 *
 * RBAC: a camada de rota DEVE exigir `requireRole('admin'|'financeiro')`.
 */
export interface SetMaterialCostInput {
  tenantId: string
  materialRowId: string
  unitCostCents: number
  materialId?: string | null
  reason: string
  actorUserId: string
}

export async function setAppointmentMaterialCost(
  supabase: SupabaseClient<Database>,
  input: SetMaterialCostInput,
): Promise<{ id: string; unitCostCents: number }> {
  if (!Number.isInteger(input.unitCostCents) || input.unitCostCents < 0) {
    throw new ValidationError('Custo unitário deve ser um inteiro ≥ 0 (centavos).')
  }
  if (!input.reason || !input.reason.trim()) {
    throw new ValidationError('Motivo é obrigatório para alterar o custo.')
  }

  // Pré-flight de tenant: confirma que a linha existe DENTRO do tenant da
  // sessão antes de chamar a RPC (não revela existência em outro tenant).
  const { data: row, error: preErr } = await supabase
    .from('appointment_materials' as never)
    .select('id')
    .eq('id', input.materialRowId)
    .eq('tenant_id', input.tenantId)
    .maybeSingle()
  if (preErr) throw new Error(`setAppointmentMaterialCost precheck failed: ${preErr.message}`)
  if (!row) throw new NotFoundError('appointment_materials', input.materialRowId)

  const { error } = await supabase.rpc('set_appointment_material_cost' as never, {
    p_material_row_id: input.materialRowId,
    p_unit_cost_cents: input.unitCostCents,
    p_material_id: input.materialId ?? null,
    p_reason: input.reason.trim(),
    p_actor: input.actorUserId,
  } as never)

  if (error) {
    const msg = error.message ?? ''
    if (/MATERIAL_ROW_NOT_FOUND/.test(msg)) {
      throw new NotFoundError('appointment_materials', input.materialRowId)
    }
    if (/MATERIAL_COST_INVALID/.test(msg)) {
      throw new ValidationError('Custo unitário inválido.')
    }
    if (/REASON_REQUIRED/.test(msg)) {
      throw new ValidationError('Motivo é obrigatório para alterar o custo.')
    }
    throw new Error(`setAppointmentMaterialCost failed: ${msg}`)
  }

  return { id: input.materialRowId, unitCostCents: input.unitCostCents }
}

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ValidationError } from '@/lib/observability/errors'
import type { ReceiptStatus } from './list'

const STATUSES: ReceiptStatus[] = ['pendente', 'recebido', 'glosado', 'nao_recebido']

export interface SetReceiptStatusInput {
  tenantId: string
  actorUserId: string
  /** Linhas de appointment_procedures (convênio) a marcar. */
  procedureLineIds: string[]
  status: ReceiptStatus
  /** Data do recebimento (YYYY-MM-DD); default hoje quando status='recebido'. */
  receivedAt?: string | null
}

/**
 * Marca o status de recebimento de N linhas de procedimento de convênio
 * (um-a-um ou em massa). Upsert por appointment_procedure_id. Deriva
 * appointment_id/plan_id/valor da própria linha (valida tenant + convênio).
 */
export async function setPlanReceiptStatus(
  supabase: SupabaseClient<Database>,
  input: SetReceiptStatusInput,
): Promise<{ updated: number }> {
  if (!STATUSES.includes(input.status)) {
    throw new ValidationError('Status inválido.')
  }
  const ids = Array.from(new Set(input.procedureLineIds)).filter(Boolean)
  if (ids.length === 0) throw new ValidationError('Selecione ao menos um procedimento.')
  if (ids.length > 500) throw new ValidationError('Máximo de 500 itens por vez.')

  // Carrega as linhas (só convênio, do tenant).
  const linesRes = await supabase
    .from('appointment_procedures')
    .select('id, appointment_id, plan_id, line_amount_cents, quantity')
    .eq('tenant_id', input.tenantId)
    .not('plan_id', 'is', null)
    .in('id', ids)
  if (linesRes.error) throw new Error(`setPlanReceiptStatus load: ${linesRes.error.message}`)
  const lines = (linesRes.data ?? []) as unknown as Array<{
    id: string
    appointment_id: string
    plan_id: string
    line_amount_cents: number
    quantity: number
  }>
  if (lines.length === 0) throw new ValidationError('Nenhuma linha de convênio válida na seleção.')

  const nowIso = new Date().toISOString()
  const receivedAt =
    input.status === 'recebido'
      ? input.receivedAt ?? new Date().toISOString().slice(0, 10)
      : null

  const rows = lines.map((l) => ({
    tenant_id: input.tenantId,
    appointment_procedure_id: l.id,
    appointment_id: l.appointment_id,
    plan_id: l.plan_id,
    status: input.status,
    received_amount_cents:
      input.status === 'recebido' ? Number(l.line_amount_cents) * Number(l.quantity ?? 1) : null,
    received_at: receivedAt,
    updated_at: nowIso,
    updated_by: input.actorUserId,
  }))

  const { error: upErr } = await supabase
    .from('plan_procedure_receipts' as never)
    .upsert(rows as never, { onConflict: 'appointment_procedure_id' })
  if (upErr) throw new Error(`setPlanReceiptStatus upsert: ${upErr.message}`)

  // Auditoria (1 entrada por operação em massa).
  await supabase.from('audit_log').insert({
    tenant_id: input.tenantId,
    actor_id: input.actorUserId,
    actor_label: null,
    entity: 'plan_procedure_receipts',
    entity_id: null,
    field: 'status',
    old_value: null,
    new_value: input.status,
    reason: `recebíveis convênio: ${lines.length} item(ns) → ${input.status}`,
    result: 'success',
  } as never)

  return { updated: lines.length }
}

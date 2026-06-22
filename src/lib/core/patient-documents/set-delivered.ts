import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { NotFoundError } from '@/lib/observability/errors'

/**
 * Backlog 1/4/2 — marca/desmarca manualmente um documento como entregue ao
 * paciente. Independente de `issued_at` (que é setado no download).
 */
export async function setPatientDocumentDelivered(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; documentId: string; delivered: boolean; actorUserId: string },
): Promise<{ deliveredAt: string | null }> {
  const deliveredAt = args.delivered ? new Date().toISOString() : null

  const { data, error } = await supabase
    .from('patient_documents' as never)
    .update({
      delivered_at: deliveredAt,
      delivered_by: args.delivered ? args.actorUserId : null,
    } as never)
    .eq('tenant_id', args.tenantId)
    .eq('id', args.documentId)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle()
  if (error) throw new Error(`setPatientDocumentDelivered failed: ${error.message}`)
  if (!data) throw new NotFoundError('patient_document', args.documentId)

  await supabase.from('audit_log').insert({
    tenant_id: args.tenantId,
    actor_id: args.actorUserId,
    actor_label: null,
    entity: 'patient_documents',
    entity_id: args.documentId,
    field: 'delivered',
    old_value: null,
    new_value: args.delivered ? 'entregue' : 'nao_entregue',
    reason: 'entrega ao paciente alternada via /api/pacientes/[id]/documentos/[docId] PATCH',
    result: 'success',
  } as never)

  return { deliveredAt }
}

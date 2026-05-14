import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ConflictError, DomainError } from '@/lib/observability/errors'

export interface RemoveAssistantInput {
  tenantId: string // não usado pela RPC (filtrada via JWT), mas mantido para clareza
  assistantRowId: string
  actorUserId: string
}

/**
 * Soft-unlink (Constitution I): UPDATE setando `removed_at`/`removed_by`.
 * RPC `remove_appointment_assistant` reusa o trigger
 * `enforce_appointment_assistants_mutation` para garantir que apenas
 * essas duas colunas mudem.
 */
export async function removeAssistant(
  supabase: SupabaseClient<Database>,
  input: RemoveAssistantInput,
): Promise<void> {
  const { error } = await supabase.rpc('remove_appointment_assistant' as never, {
    p_id: input.assistantRowId,
    p_actor: input.actorUserId,
  } as never)
  if (error) {
    const msg = error.message ?? ''
    if (/ASSISTANT_NOT_FOUND/.test(msg)) {
      throw new DomainError('ASSISTANT_NOT_FOUND', 'Assistente não encontrado.', { status: 404 })
    }
    if (/ASSISTANT_ALREADY_REMOVED/.test(msg)) {
      throw new ConflictError(
        'ASSISTANT_ALREADY_REMOVED',
        'Assistente já foi removido anteriormente.',
      )
    }
    throw new Error(`remove_appointment_assistant failed: ${msg}`)
  }
}

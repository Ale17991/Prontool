import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

/**
 * Feature 012 — US2 — invoca RPC `generate_user_notifications` (lazy, idempotente).
 *
 * Antes da RPC, seta `app.encryption_key` session-scoped para que a RPC
 * possa decifrar `birth_date_enc` ao agregar aniversariantes do mês.
 * Se a chave não estiver disponível, a RPC pula a categoria silenciosamente.
 */
export interface GenerateInput {
  tenantId: string
  userId: string
}

export interface GenerateResult {
  inserted_atendimento: number
  inserted_tarefa: number
  inserted_tarefa_atrasada: number
  inserted_aniversarios: number
}

export async function generateUserNotifications(
  supabase: SupabaseClient<Database>,
  input: GenerateInput,
): Promise<GenerateResult> {
  // Best-effort: seta a chave via RPC helper se existir (mesmo padrão usado
  // em decrypt_patient_names_for_ids). Falha silenciosa quando a chave não
  // está disponível — a RPC apenas pula a parte de aniversariantes.
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (key) {
    try {
      await supabase.rpc('set_patient_encryption_key_for_test' as never)
    } catch {
      // Ignora — RPC opcional; ambientes que não a tem operam sem aniversariantes.
    }
  }

  const { data, error } = await supabase.rpc(
    'generate_user_notifications' as never,
    { p_tenant_id: input.tenantId, p_user_id: input.userId } as never,
  )
  if (error) {
    throw new Error(`generateUserNotifications RPC failed: ${error.message}`)
  }
  return (data ?? {
    inserted_atendimento: 0,
    inserted_tarefa: 0,
    inserted_tarefa_atrasada: 0,
    inserted_aniversarios: 0,
  }) as unknown as GenerateResult
}

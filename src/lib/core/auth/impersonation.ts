import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

/**
 * Feature 043 (US5) — impersonação READ-ONLY do super-admin.
 *
 * Cookie marca a sessão como impersonação. O middleware bloqueia TODA escrita
 * (métodos mutantes) enquanto ele estiver presente — a leitura passa. Valor:
 * `${tenantImpersonado}:${tenantAnterior ?? ''}` (para restaurar na saída).
 */
export const IMPERSONATION_COOKIE = 'clinni_impersonation'

/** Métodos HTTP que escrevem — bloqueados durante a impersonação. */
export const MUTATING_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Remove o tenant ativo do usuário (volta ao "contexto de plataforma"): limpa
 * `user_metadata.active_tenant_id` e a linha em `user_active_tenant`. O auth
 * hook, sem tenant, deixa o JWT sem `app_metadata.tenant_id`. Requer service
 * client. O cliente DEVE chamar `refreshSession()` depois.
 */
export async function clearActiveTenant(
  supabaseService: SupabaseClient<Database>,
  userId: string,
): Promise<void> {
  const { data: u } = await supabaseService.auth.admin.getUserById(userId)
  const meta = (u?.user?.user_metadata ?? {}) as Record<string, unknown>
  const next = { ...meta }
  delete next.active_tenant_id
  await supabaseService.auth.admin.updateUserById(userId, { user_metadata: next })
  await supabaseService.from('user_active_tenant').delete().eq('user_id', userId)
}

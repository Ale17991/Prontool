import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { canUser, type Action, type PermissionOverride, type OverrideEffect } from './rbac'
import type { TenantRole } from '@/lib/db/types'

/**
 * Feature 043 — carga dos overrides de permissão de um usuário (servidor).
 *
 * Fonte da verdade no DB → mudanças valem imediatamente (não dependem de
 * refresh de JWT). Linha em `user_permission_overrides` = (action, effect).
 *
 * Em caso de erro de leitura, retorna [] (cai para o papel base) — postura
 * defensiva consistente com o restante do app; nenhuma concessão extra é
 * inventada por erro.
 */
export async function getUserOverrides(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  userId: string,
): Promise<PermissionOverride[]> {
  const { data, error } = await supabase
    .from('user_permission_overrides' as never)
    .select('action, effect')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
  if (error) {
    console.error('getUserOverrides failed', { tenantId, userId, error: error.message })
    return []
  }
  const rows = (data ?? []) as unknown as Array<{ action: string; effect: string }>
  return rows
    .filter((r) => r.effect === 'grant' || r.effect === 'deny')
    .map((r) => ({ action: r.action as Action, effect: r.effect as OverrideEffect }))
}

/**
 * Conjunto efetivo de ações de um usuário (papel + overrides). Útil para a UI
 * refletir o efeito combinado. A checagem autoritativa usa `canUser`.
 */
export function computeEffective(
  role: TenantRole,
  overrides: readonly PermissionOverride[],
  allActions: readonly Action[],
): Set<Action> {
  const out = new Set<Action>()
  for (const a of allActions) {
    if (canUser(role, overrides, a)) out.add(a)
  }
  return out
}

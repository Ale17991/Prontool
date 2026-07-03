import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ValidationError } from '@/lib/observability/errors'
import { PROTECTED_ACTIONS, type Action, type OverrideEffect } from '@/lib/auth/rbac'

/**
 * Feature 043 — aplica mudanças de override de permissão de um usuário.
 *
 * `inherit` remove o override (volta ao papel). `grant`/`deny` fazem upsert.
 * Ações PROTEGIDAS (Princípio V) são rejeitadas. Cada mudança efetiva gera
 * auditoria (antes/depois). Ator deve ser admin do tenant ou super-admin —
 * validado na camada chamadora (route handler / action).
 */
export interface OverrideChange {
  action: Action
  effect: OverrideEffect | 'inherit'
}

export async function setUserPermissionOverrides(
  supabaseService: SupabaseClient<Database>,
  input: {
    tenantId: string
    targetUserId: string
    actorUserId: string
    actorLabel?: string | null
    changes: OverrideChange[]
    reason?: string
  },
): Promise<{ applied: number }> {
  const changes = input.changes ?? []
  if (changes.length === 0) return { applied: 0 }

  // Não permitir override em ações protegidas (Princípio V).
  const blocked = changes.find((c) => PROTECTED_ACTIONS.includes(c.action))
  if (blocked) {
    throw new ValidationError(`Ação protegida não pode ter override: ${blocked.action}`)
  }

  // Estado atual para auditoria antes/depois.
  const cur = await supabaseService
    .from('user_permission_overrides' as never)
    .select('action, effect')
    .eq('tenant_id', input.tenantId)
    .eq('user_id', input.targetUserId)
  if (cur.error) throw new Error(`load overrides failed: ${cur.error.message}`)
  const before = new Map<string, string>()
  for (const r of (cur.data ?? []) as unknown as Array<{ action: string; effect: string }>) {
    before.set(r.action, r.effect)
  }

  const nowIso = new Date().toISOString()
  let applied = 0

  for (const ch of changes) {
    const prev = before.get(ch.action) ?? 'inherit'
    if (prev === ch.effect) continue // no-op

    if (ch.effect === 'inherit') {
      const { error } = await supabaseService
        .from('user_permission_overrides' as never)
        .delete()
        .eq('tenant_id', input.tenantId)
        .eq('user_id', input.targetUserId)
        .eq('action', ch.action)
      if (error) throw new Error(`override delete failed: ${error.message}`)
    } else {
      const { error } = await supabaseService.from('user_permission_overrides' as never).upsert(
        {
          tenant_id: input.tenantId,
          user_id: input.targetUserId,
          action: ch.action,
          effect: ch.effect,
          created_by: input.actorUserId,
          updated_at: nowIso,
        } as never,
        { onConflict: 'tenant_id,user_id,action' },
      )
      if (error) throw new Error(`override upsert failed: ${error.message}`)
    }

    applied++
    await supabaseService.from('audit_log').insert({
      tenant_id: input.tenantId,
      actor_id: input.actorUserId,
      actor_label: input.actorLabel ?? null,
      entity: 'user_permission_overrides',
      entity_id: input.targetUserId,
      field: ch.action,
      old_value: prev,
      new_value: ch.effect,
      reason: input.reason ?? 'override de permissão',
      result: 'success',
    } as never)
  }

  return { applied }
}

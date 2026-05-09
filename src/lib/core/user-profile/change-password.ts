import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ConflictError, ValidationError } from '@/lib/observability/errors'
import { validatePasswordStrength } from './types'

interface ChangePasswordContext {
  ip?: string | null
  userAgent?: string | null
  tenantId: string
}

/**
 * Troca de senha do usuário autenticado.
 *
 * Fluxo (research.md R9):
 *  1. Valida força da nova senha (≥ 8 chars, ≥ 1 letra, ≥ 1 dígito).
 *  2. Reautentica com `currentPassword` em um client isolado (sem
 *     persistir sessão) para confirmar que é o dono da conta.
 *  3. Chama `auth.updateUser({ password })` no client da sessão.
 *  4. Audit `entity=user_profile, field=password` (sem old/new — zero PII
 *     de senha em audit_log, Constituição §II combinada com LGPD).
 */
export async function changePassword(
  supabase: SupabaseClient<Database>,
  userId: string,
  email: string,
  currentPassword: string,
  newPassword: string,
  context: ChangePasswordContext,
): Promise<void> {
  if (currentPassword === newPassword) {
    throw new ValidationError('A nova senha deve ser diferente da atual', {
      reason: 'same_password',
    })
  }

  const policy = validatePasswordStrength(newPassword)
  if (policy) {
    throw new ValidationError('Nova senha não atende à política mínima', {
      code: 'WEAK_PASSWORD',
      reason: policy.reason,
    })
  }

  // Reauth via client isolado — não polui cookies/sessão atual.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY missing')
  }

  const isolated = createClient(url, anon, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
  const { error: signInError } = await isolated.auth.signInWithPassword({
    email,
    password: currentPassword,
  })
  if (signInError) {
    throw new ConflictError('INVALID_CURRENT_PASSWORD', 'Senha atual incorreta')
  }

  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
  if (updateError) {
    throw new Error(`changePassword updateUser failed: ${updateError.message}`)
  }

  await supabase.from('audit_log').insert({
    tenant_id: context.tenantId,
    actor_id: userId,
    actor_label: email,
    entity: 'user_profile',
    entity_id: userId,
    field: 'password',
    old_value: null,
    new_value: null,
    reason: 'password changed via /api/configuracoes/perfil/senha POST',
    ip: context.ip ?? null,
    user_agent: context.userAgent ?? null,
    result: 'success',
  })
}

import type { SupabaseClient } from '@supabase/supabase-js'
import { getSession, type ActiveSession } from './get-session'
import { getSessionFromRequest } from './get-session-from-request'
import { getUserOverrides } from './overrides'
import { canUser, type Action } from './rbac'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import type { Database } from '@/lib/db/types'
import { ForbiddenError, UnauthorizedError } from '@/lib/observability/errors'
import { denyAudit } from '@/lib/core/audit/deny'

/**
 * Feature 043 — autorização por AÇÃO efetiva (papel + overrides do usuário).
 *
 * Diferente de `requireRole` (gate por papel), aqui a permissão é avaliada
 * pela ação: `canUser(role, overrides, action)`. Adotar nos endpoints/telas
 * onde overrides devem valer. Overrides lidos do DB (valem imediatamente).
 */

/** Lê os overrides do ator via client RLS (o usuário lê os do próprio tenant). */
async function loadActorOverrides(tenantId: string, userId: string) {
  const sb = createSupabaseServerClient() as unknown as SupabaseClient<Database>
  return getUserOverrides(sb, tenantId, userId)
}

/**
 * Checagem booleana da permissão EFETIVA da sessão atual (cookie). Para
 * server components/páginas decidirem o que mostrar/enviar. NÃO lança.
 */
export async function userCan(action: Action): Promise<boolean> {
  const session = await getSession()
  if (!session) return false
  const overrides = await loadActorOverrides(session.tenantId, session.userId)
  return canUser(session.role, overrides, action)
}

/**
 * Exige que o ator tenha a AÇÃO efetiva. Em falha:
 *   - sem sessão → UnauthorizedError (401)
 *   - sem a ação (papel ∪ grants ∖ denies) → ForbiddenError (403) + audit.deny
 *
 * Use em route handlers/server actions onde a ação deve respeitar overrides.
 */
export async function requireAction(
  action: Action,
  context: {
    entity: string
    entityId?: string
    route: string
    ip?: string
    userAgent?: string
    request?: Request
  },
): Promise<ActiveSession> {
  const session = context.request
    ? await getSessionFromRequest(context.request)
    : await getSession()
  if (!session) throw new UnauthorizedError('Not authenticated')

  const overrides = await loadActorOverrides(session.tenantId, session.userId)
  if (!canUser(session.role, overrides, action)) {
    await denyAudit({
      tenantId: session.tenantId,
      actorId: session.userId,
      actorLabel: session.email ? `user:${session.email}` : `user:${session.userId}`,
      entity: context.entity,
      entityId: context.entityId,
      reason: `action ${action} not in effective permissions of role ${session.role}`,
      ip: context.ip,
      userAgent: context.userAgent,
      result: 'denied',
    })
    throw new ForbiddenError(`Missing permission for ${action}`)
  }

  return session
}

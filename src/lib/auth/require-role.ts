import { getSession, type ActiveSession } from './get-session'
import { getSessionFromRequest } from './get-session-from-request'
import { ForbiddenError, UnauthorizedError } from '@/lib/observability/errors'
import type { TenantRole } from '@/lib/db/types'
import { denyAudit } from '@/lib/core/audit/deny'

/**
 * Asserts the caller has one of the allowed roles. On failure:
 *   - no session → UnauthorizedError (401)
 *   - session but wrong role → ForbiddenError (403) + audit.deny entry
 *
 * When `context.request` is provided, authentication tries the
 * `Authorization: Bearer` header first (API clients, tests) before falling
 * back to the cookie-based session (browser SSR).
 */
export async function requireRole(
  allowed: readonly TenantRole[],
  context: {
    entity: string
    entityId?: string
    route: string
    ip?: string
    userAgent?: string
    request?: Request
  },
): Promise<ActiveSession> {
  const session = context.request ? await getSessionFromRequest(context.request) : await getSession()
  if (!session) throw new UnauthorizedError('Not authenticated')

  if (!allowed.includes(session.role)) {
    await denyAudit({
      tenantId: session.tenantId,
      actorId: session.userId,
      actorLabel: session.email ? `user:${session.email}` : `user:${session.userId}`,
      entity: context.entity,
      entityId: context.entityId,
      reason: `role ${session.role} not in [${allowed.join(',')}]`,
      ip: context.ip,
      userAgent: context.userAgent,
      result: 'denied',
    })
    throw new ForbiddenError(`Role ${session.role} cannot perform this action`)
  }

  return session
}

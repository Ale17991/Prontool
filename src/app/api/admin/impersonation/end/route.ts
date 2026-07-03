import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { superAdminUserId } from '@/lib/auth/platform-admin'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { switchActiveTenant } from '@/lib/core/auth/switch-tenant'
import { IMPERSONATION_COOKIE, clearActiveTenant } from '@/lib/core/auth/impersonation'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * Feature 043 (US5) — encerra a impersonação. Restaura o tenant anterior do
 * super-admin (ou limpa, voltando ao contexto de plataforma) e remove o cookie.
 * Exposto sob /api/admin/impersonation/* (isento do bloqueio de escrita do
 * middleware). Cliente DEVE chamar `refreshSession()` após o 200.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
const ROUTE = '/api/admin/impersonation/end'

export async function POST(): Promise<Response> {
  try {
    const actorId = await superAdminUserId()
    if (!actorId) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Não autorizado.' } },
        { status: 403 },
      )
    }

    const raw = cookies().get(IMPERSONATION_COOKIE)?.value ?? ''
    const [impTenant, prevTenant] = raw.split(':')

    const sb = createSupabaseServiceClient()
    if (prevTenant) {
      await switchActiveTenant(sb, { userId: actorId, tenantId: prevTenant, userEmail: null })
    } else {
      await clearActiveTenant(sb, actorId)
    }

    if (impTenant) {
      await sb.from('audit_log').insert({
        tenant_id: impTenant,
        actor_id: actorId,
        actor_label: 'super-admin',
        entity: 'session',
        entity_id: actorId,
        field: 'impersonation_end',
        old_value: JSON.stringify({ tenant_id: impTenant }),
        new_value: prevTenant ? JSON.stringify({ tenant_id: prevTenant }) : null,
        reason: 'impersonação read-only encerrada',
        result: 'success',
      } as never)
    }

    const res = NextResponse.json({ ok: true })
    res.cookies.set(IMPERSONATION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 })
    return res
  } catch (err) {
    return toHttpResponse(err, { route: ROUTE })
  }
}

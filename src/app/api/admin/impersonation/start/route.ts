import { NextResponse } from 'next/server'
import { superAdminUserId } from '@/lib/auth/platform-admin'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { switchActiveTenant } from '@/lib/core/auth/switch-tenant'
import { IMPERSONATION_COOKIE } from '@/lib/core/auth/impersonation'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * Feature 043 (US5) — inicia impersonação READ-ONLY de uma clínica.
 * Super-admin entra no contexto do tenant alvo (switch re-emite o JWT → RLS de
 * leitura) e marca a sessão como impersonação via cookie (o middleware bloqueia
 * escrita). Cliente DEVE chamar `refreshSession()` após o 200.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
const ROUTE = '/api/admin/impersonation/start'

export async function POST(req: Request): Promise<Response> {
  try {
    const actorId = await superAdminUserId()
    if (!actorId) {
      return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Não autorizado.' } }, { status: 403 })
    }
    const body = (await req.json().catch(() => null)) as { tenantId?: string } | null
    const tenantId = body?.tenantId
    if (!tenantId) {
      return NextResponse.json({ error: { code: 'INVALID_BODY', message: 'tenantId obrigatório.' } }, { status: 400 })
    }

    const sb = createSupabaseServiceClient()
    const { previousTenantId } = await switchActiveTenant(sb, {
      userId: actorId,
      tenantId,
      userEmail: null,
    })

    await sb.from('audit_log').insert({
      tenant_id: tenantId,
      actor_id: actorId,
      actor_label: 'super-admin',
      entity: 'session',
      entity_id: actorId,
      field: 'impersonation_start',
      old_value: previousTenantId ? JSON.stringify({ tenant_id: previousTenantId }) : null,
      new_value: JSON.stringify({ tenant_id: tenantId, mode: 'read_only' }),
      reason: 'impersonação read-only iniciada pelo super-admin',
      result: 'success',
    } as never)

    const res = NextResponse.json({ ok: true })
    res.cookies.set(IMPERSONATION_COOKIE, `${tenantId}:${previousTenantId ?? ''}`, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    })
    return res
  } catch (err) {
    return toHttpResponse(err, { route: ROUTE })
  }
}

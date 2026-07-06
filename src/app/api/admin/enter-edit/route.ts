import { NextResponse } from 'next/server'
import { superAdminUserId } from '@/lib/auth/platform-admin'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { switchActiveTenant } from '@/lib/core/auth/switch-tenant'
import { IMPERSONATION_COOKIE } from '@/lib/core/auth/impersonation'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * "Entrar e editar" — switch de escrita para o super-admin (0171).
 *
 * Diferente de /api/admin/impersonation/start (read-only): NÃO seta o cookie de
 * impersonação e chama switchActiveTenant SEM readOnly, então a flag
 * `support_view_tenant_id` é limpa e o auth hook NÃO marca `impersonation` no
 * JWT → escrita liberada. Também apaga qualquer cookie de impersonação residual
 * de uma visualização anterior (senão o middleware seguiria bloqueando escrita).
 *
 * Só super-admin (superAdminUserId). Suporte não-super cai no 403 e usa apenas
 * o "Só visualizar". Cliente DEVE chamar `refreshSession()` após o 200.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
const ROUTE = '/api/admin/enter-edit'

export async function POST(req: Request): Promise<Response> {
  try {
    const actorId = await superAdminUserId()
    if (!actorId) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Não autorizado.' } },
        { status: 403 },
      )
    }
    const body = (await req.json().catch(() => null)) as { tenantId?: string } | null
    const tenantId = body?.tenantId
    if (!tenantId) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'tenantId obrigatório.' } },
        { status: 400 },
      )
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
      field: 'admin_enter_edit',
      old_value: previousTenantId ? JSON.stringify({ tenant_id: previousTenantId }) : null,
      new_value: JSON.stringify({ tenant_id: tenantId, mode: 'read_write' }),
      reason: 'super-admin entrou na clínica com edição',
      result: 'success',
    } as never)

    const res = NextResponse.json({ ok: true })
    // Apaga cookie de impersonação residual (se veio de um "Só visualizar").
    res.cookies.set(IMPERSONATION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 })
    return res
  } catch (err) {
    return toHttpResponse(err, { route: ROUTE })
  }
}

import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { toHttpResponse } from '@/lib/observability/http'
import { ForbiddenError, NotFoundError } from '@/lib/observability/errors'
import { can } from '@/lib/auth/rbac'
import { TENANT_ROLES_ORDERED } from '@/lib/core/team/types'
import type { TenantRole } from '@/lib/db/types'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { deleteGoogleConnection } from '@/lib/integrations/google-calendar/oauth/token-store'

/**
 * POST /api/oauth/google-calendar/disconnect
 * Desconecta a agenda Google. Sem corpo, desconecta a do próprio usuário.
 * Com `{ doctor_id }`, desconecta a do profissional indicado — permitido a
 * quem tem `doctor.write` (saída da clínica, revogação de acesso) ou ao próprio
 * profissional. Desconectar é seguro de delegar; CONECTAR não é, porque o
 * consentimento é dado na conta Google de quem está no navegador.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request): Promise<Response> {
  const route = '/api/oauth/google-calendar/disconnect'
  try {
    const session = await requireRole(TENANT_ROLES_ORDERED as readonly TenantRole[], {
      entity: 'user_integrations',
      route,
      request: req,
    })
    const supabase = createSupabaseServiceClient()

    const body = (await req.json().catch(() => ({}))) as { doctor_id?: unknown }
    const doctorId = typeof body.doctor_id === 'string' ? body.doctor_id : null

    let targetUserId = session.userId
    if (doctorId) {
      const { data } = await supabase
        .from('doctors')
        .select('user_id')
        .eq('tenant_id', session.tenantId)
        .eq('id', doctorId)
        .maybeSingle()
      const linked = (data as { user_id: string | null } | null)?.user_id ?? null
      // Sem vínculo não há o que desconectar — e devolver 404 evita confirmar a
      // existência de profissional de outra clínica.
      if (!linked) throw new NotFoundError('Profissional', doctorId)
      if (linked !== session.userId && !can(session.role, 'doctor.write')) {
        throw new ForbiddenError('Só um administrador pode desconectar a agenda de outro profissional.')
      }
      targetUserId = linked
    }

    await deleteGoogleConnection(supabase, targetUserId, session.tenantId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

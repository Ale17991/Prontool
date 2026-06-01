import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { enablePrescriber } from '@/lib/core/integrations/memed/register-prescriber'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * POST /api/medicos/{id}/memed-prescritor → habilita o profissional como
 * prescritor na Memed (admin-only). Valida conexão + campos do cadastro;
 * 400 (apontando a edição) quando falta dado, 424 se a clínica não está
 * conectada.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/medicos/${params.id}/memed-prescritor`
  try {
    const session = await requireRole(['admin'], {
      entity: 'memed_prescribers',
      entityId: params.id,
      route,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    const result = await enablePrescriber({
      supabase,
      tenantId: session.tenantId,
      doctorId: params.id,
      actorUserId: session.userId,
      actorLabel: session.email ? `user:${session.email}` : `user:${session.userId}`,
      ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: req.headers.get('user-agent'),
    })
    return NextResponse.json({ status: result.status, external_id: result.externalId }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

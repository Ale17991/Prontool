import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { deleteTissCertificate } from '@/lib/core/tiss/certificates'
import { toHttpResponse } from '@/lib/observability/http'

/** DELETE /api/tiss/certificados/[id] → remove o certificado (admin). */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ROUTE = '/api/tiss/certificados/[id]'

function clientIp(req: Request): string | null {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
}
function actorLabel(email: string | null, userId: string): string {
  return email ? `user:${email}` : `user:${userId}`
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const session = await requireRole(['admin'], {
      entity: 'tenant_tiss_certificates',
      route: ROUTE,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    const result = await deleteTissCertificate({
      supabase,
      tenantId: session.tenantId,
      certificateId: params.id,
      actorUserId: session.userId,
      actorLabel: actorLabel(session.email, session.userId),
      ip: clientIp(req),
      userAgent: req.headers.get('user-agent'),
    })
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route: ROUTE })
  }
}

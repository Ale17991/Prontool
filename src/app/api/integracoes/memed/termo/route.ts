import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { acceptMemedTerms } from '@/lib/core/integrations/memed/environment'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * POST /api/integracoes/memed/termo → registra o aceite do termo de
 * responsabilidade (terms_accepted_at/by), pré-requisito para ativar produção
 * (FR-024). Admin-only.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ROUTE = '/api/integracoes/memed/termo'

export async function POST(req: Request): Promise<Response> {
  try {
    const session = await requireRole(['admin'], {
      entity: 'tenant_memed_config',
      route: ROUTE,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    const result = await acceptMemedTerms({
      supabase,
      tenantId: session.tenantId,
      actorUserId: session.userId,
      actorLabel: session.email ? `user:${session.email}` : `user:${session.userId}`,
      ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: req.headers.get('user-agent'),
    })
    return NextResponse.json({ terms_accepted_at: result.termsAcceptedAt }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route: ROUTE })
  }
}

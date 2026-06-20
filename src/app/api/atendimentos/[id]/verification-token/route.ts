import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { generateVerificationToken } from '@/lib/core/surgical-scans/verification-service'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/atendimentos/${params.id}/verification-token`
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'document_verification_tokens',
      entityId: params.id,
      route,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    const token = await generateVerificationToken(supabase, session.tenantId, params.id)
    return NextResponse.json({ token, path: `/verificar/${token}` }, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

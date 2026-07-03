import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getPrescriberToken } from '@/lib/core/integrations/memed/get-prescriber-token'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * GET /api/medicos/{id}/memed-token → token JWT fresco do prescritor para
 * inicializar o iframe da Memed. Resposta: `{ token }` — NUNCA chaves.
 * 409 se o profissional não está registrado; 424 se a clínica não conectada.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const route = `/api/medicos/${params.id}/memed-token`
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'memed_prescribers',
      entityId: params.id,
      route,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    const { token } = await getPrescriberToken({
      supabase,
      tenantId: session.tenantId,
      doctorId: params.id,
    })
    return NextResponse.json({ token }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

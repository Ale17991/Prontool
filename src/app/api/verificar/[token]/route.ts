import { NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { verifyToken, incrementVerification } from '@/lib/core/surgical-scans/verification-service'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// PÚBLICO — sem auth. Não retorna dados do paciente.
export async function GET(
  _req: Request,
  { params }: { params: { token: string } },
): Promise<Response> {
  const route = '/api/verificar'
  try {
    const supabase = createSupabaseServiceClient()
    const result = await verifyToken(supabase, params.token)
    if (result.valid) {
      await incrementVerification(supabase, params.token).catch(() => {})
    }
    return NextResponse.json(result, { status: result.valid ? 200 : 404 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

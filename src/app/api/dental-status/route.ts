import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { listActiveStatuses } from '@/lib/core/dental/status-catalog/list'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Catálogo de status ativo para a paleta — qualquer usuário autenticado. */
export async function GET(req: Request): Promise<Response> {
  const route = '/api/dental-status'
  try {
    await requireRole(['admin', 'financeiro', 'recepcionista', 'profissional_saude'], {
      entity: 'dental_status_catalog',
      route,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    const catalog = await listActiveStatuses(supabase)
    return NextResponse.json({ catalog }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

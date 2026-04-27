import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { softDeleteHistory } from '@/lib/core/patient-medical/history'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function DELETE(
  req: Request,
  { params }: { params: { id: string; historyId: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/antecedentes/${params.historyId}`
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'patient_history',
      entityId: params.historyId,
      route,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    await softDeleteHistory(supabase, {
      tenantId: session.tenantId,
      historyId: params.historyId,
    })
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

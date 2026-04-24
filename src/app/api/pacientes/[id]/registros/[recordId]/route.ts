import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { softDeleteClinicalRecord } from '@/lib/core/clinical-records/soft-delete'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * DELETE /api/pacientes/{id}/registros/{recordId} — soft-delete.
 * Permissão: admin / financeiro. 404 se inexistente, 409 se já removido.
 *
 * `id` (paciente) na URL é apenas pra o front formatar a rota; o lookup
 * usa `recordId` + tenant scoping.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function DELETE(
  req: Request,
  { params }: { params: { id: string; recordId: string } },
): Promise<Response> {
  try {
    const session = await requireRole(['admin', 'financeiro'], {
      entity: 'clinical_records',
      entityId: params.recordId,
      route: `/api/pacientes/${params.id}/registros/${params.recordId}`,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    const result = await softDeleteClinicalRecord(supabase, {
      tenantId: session.tenantId,
      recordId: params.recordId,
    })
    return NextResponse.json(
      { id: result.id, deleted_at: result.deletedAt },
      { status: 200 },
    )
  } catch (err) {
    return toHttpResponse(err, {
      route: `/api/pacientes/${params.id}/registros/${params.recordId}`,
    })
  }
}

import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { applyTemplateToPatient } from '@/lib/core/document-templates/apply'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET — resolve um modelo para o paciente (placeholders já substituídos),
 * para o usuário revisar/editar antes de emitir.
 */
export async function GET(
  req: Request,
  { params }: { params: { id: string; templateId: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/documentos/modelo/${params.templateId}`
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'document_templates',
      entityId: params.templateId,
      route,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    const applied = await applyTemplateToPatient(supabase, {
      tenantId: session.tenantId,
      templateId: params.templateId,
      patientId: params.id,
    })
    return NextResponse.json(applied, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

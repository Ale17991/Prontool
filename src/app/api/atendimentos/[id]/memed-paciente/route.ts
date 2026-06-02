import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { buildSetPaciente } from '@/lib/core/integrations/memed/set-paciente'
import { NotFoundError } from '@/lib/observability/errors'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * GET /api/atendimentos/{id}/memed-paciente → payload do `setPaciente` para
 * pré-carregar o paciente do atendimento no iframe da Memed. PII decifrada
 * server-side. 422 listando campos faltantes (nome/CPF/e-mail/celular/
 * nascimento).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/atendimentos/${params.id}/memed-paciente`
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'appointments',
      entityId: params.id,
      route,
      request: req,
    })
    const supabase = createSupabaseServiceClient()

    const { data: appt, error } = await supabase
      .from('appointments')
      .select('patient_id')
      .eq('tenant_id', session.tenantId)
      .eq('id', params.id)
      .maybeSingle()
    if (error) throw new Error(`failed to load appointment: ${error.message}`)
    if (!appt) throw new NotFoundError('appointment', params.id)

    const paciente = await buildSetPaciente({
      supabase,
      tenantId: session.tenantId,
      patientId: (appt as { patient_id: string }).patient_id,
    })
    return NextResponse.json({ paciente }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { bulkCleanupPatient } from '@/lib/core/patients/bulk-cleanup'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * POST /api/pacientes/{id}/limpar — soft-delete em lote dos dados
 * clínicos do paciente. Admin only. NUNCA remove dados de atendimento
 * (appointments) ou faturamento — protegidos por lei.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodySchema = z.object({
  remove_anamneses: z.boolean().optional(),
  remove_records: z.boolean().optional(),
  remove_steps: z.boolean().optional(),
})

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/limpar`
  try {
    const session = await requireRole(['admin'], {
      entity: 'patients',
      entityId: params.id,
      route,
      request: req,
    })
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_BODY',
            message:
              'Esperado { remove_anamneses?, remove_records?, remove_steps? }',
          },
        },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const result = await bulkCleanupPatient(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
      removeAnamneses: parsed.data.remove_anamneses ?? false,
      removeRecords: parsed.data.remove_records ?? false,
      removeSteps: parsed.data.remove_steps ?? false,
    })
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

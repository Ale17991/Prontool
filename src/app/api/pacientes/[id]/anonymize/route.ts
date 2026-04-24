import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { anonymizePatient } from '@/lib/core/patients/anonymize'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * POST /api/pacientes/{id}/anonymize — LGPD right to erasure.
 *
 * Operação IRREVERSÍVEL: substitui PII do paciente e de todos os
 * registros clínicos por placeholders, remove arquivos do bucket.
 * Permissão: `admin` apenas. Body exige `reason` (mín 10 chars) pra
 * registrar na trilha de auditoria.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodySchema = z.object({
  reason: z.string().min(10).max(500),
})

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const session = await requireRole(['admin'], {
      entity: 'patients',
      entityId: params.id,
      route: `/api/pacientes/${params.id}/anonymize`,
      request: req,
    })
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: { code: 'INVALID_BODY', message: 'reason obrigatório (10..500 caracteres)' },
        },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const result = await anonymizePatient(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
      actorUserId: session.userId,
      reason: parsed.data.reason,
    })
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route: `/api/pacientes/${params.id}/anonymize` })
  }
}

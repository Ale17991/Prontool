import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import {
  softDeleteDiagnosis,
  updateDiagnosisStatus,
  type DiagnosisStatus,
} from '@/lib/core/patient-medical/diagnoses'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const patchSchema = z.object({
  status: z.enum(['ativo', 'em_acompanhamento', 'resolvido']),
})

export async function PATCH(
  req: Request,
  { params }: { params: { id: string; diagnosisId: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/diagnosticos/${params.diagnosisId}`
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'patient_diagnoses',
      entityId: params.diagnosisId,
      route,
      request: req,
    })
    const parsed = patchSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_BODY',
            message: 'Payload inválido',
            issues: parsed.error.issues,
          },
        },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const result = await updateDiagnosisStatus(supabase, {
      tenantId: session.tenantId,
      diagnosisId: params.diagnosisId,
      status: parsed.data.status as DiagnosisStatus,
    })
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string; diagnosisId: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/diagnosticos/${params.diagnosisId}`
  try {
    const session = await requireRole(['admin'], {
      entity: 'patient_diagnoses',
      entityId: params.diagnosisId,
      route,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    await softDeleteDiagnosis(supabase, {
      tenantId: session.tenantId,
      diagnosisId: params.diagnosisId,
    })
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

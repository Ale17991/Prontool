import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import {
  createDiagnosis,
  listDiagnoses,
  type DiagnosisStatus,
} from '@/lib/core/patient-medical/diagnoses'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const createSchema = z.object({
  cid10_code: z.string().trim().min(1).max(20),
  cid10_description: z.string().trim().min(1).max(500),
  additional_notes: z.string().trim().max(2000).optional().nullable(),
  diagnosed_at: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  status: z.enum(['ativo', 'em_acompanhamento', 'resolvido']).optional(),
})

export async function GET(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const route = `/api/pacientes/${params.id}/diagnosticos`
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      { entity: 'patient_diagnoses', entityId: params.id, route, request: req },
    )
    const supabase = createSupabaseServiceClient()
    const items = await listDiagnoses(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
    })
    return NextResponse.json(items, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/diagnosticos`
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'patient_diagnoses',
      entityId: params.id,
      route,
      request: req,
    })
    const parsed = createSchema.safeParse(await req.json().catch(() => null))
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
    const result = await createDiagnosis(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
      actorUserId: session.userId,
      cid10Code: parsed.data.cid10_code,
      cid10Description: parsed.data.cid10_description,
      additionalNotes: parsed.data.additional_notes ?? null,
      diagnosedAt: parsed.data.diagnosed_at ?? null,
      status: (parsed.data.status as DiagnosisStatus | undefined) ?? 'ativo',
    })
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getPerioExam } from '@/lib/core/dental/perio/get-exam'
import { savePerioMeasurements } from '@/lib/core/dental/perio/save-measurements'
import { discardPerioExam } from '@/lib/core/dental/perio/discard-exam'
import { perioIndicators } from '@/lib/core/dental/perio/get-exam'
import { PERIO_SITES } from '@/lib/core/dental/perio/sites'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const measurementSchema = z.object({
  toothFdi: z.number().int(),
  site: z.enum(PERIO_SITES),
  probingDepthMm: z.number().int().min(0).max(15).optional().nullable(),
  recessionMm: z.number().int().min(-5).max(15).optional().nullable(),
  bleeding: z.boolean().optional(),
  suppuration: z.boolean().optional(),
  plaque: z.boolean().optional(),
})

const findingSchema = z.object({
  toothFdi: z.number().int(),
  mobility: z.number().int().min(0).max(3).optional().nullable(),
  furcation: z.number().int().min(1).max(3).optional().nullable(),
  isMissing: z.boolean().optional(),
  isImplant: z.boolean().optional(),
})

const patchSchema = z
  .object({
    measurements: z.array(measurementSchema).max(256).optional(),
    findings: z.array(findingSchema).max(64).optional(),
    notes: z.string().max(2000).optional().nullable(),
  })
  .refine((v) => v.measurements || v.findings || v.notes !== undefined, {
    message: 'Nada para salvar',
  })

/** Exame completo. */
export async function GET(
  req: Request,
  { params }: { params: { id: string; examId: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/periograma/${params.examId}`
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      { entity: 'perio_exams', entityId: params.examId, route, request: req },
    )
    const supabase = createSupabaseServiceClient()
    const data = await getPerioExam(supabase, { tenantId: session.tenantId, examId: params.examId })
    return NextResponse.json(data, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

/** Salva em lote medições/achados (só rascunho). */
export async function PATCH(
  req: Request,
  { params }: { params: { id: string; examId: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/periograma/${params.examId}`
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'perio_exams',
      entityId: params.examId,
      route,
      request: req,
    })
    const parsed = patchSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: { code: 'INVALID_BODY', message: 'Payload inválido', issues: parsed.error.issues },
        },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    await savePerioMeasurements(supabase, {
      tenantId: session.tenantId,
      examId: params.examId,
      measurements: parsed.data.measurements,
      findings: parsed.data.findings,
      notes: parsed.data.notes,
    })
    const indicators = await perioIndicators(supabase, session.tenantId, params.examId)
    return NextResponse.json({ ok: true, indicators }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

/** Descarta um rascunho. */
export async function DELETE(
  req: Request,
  { params }: { params: { id: string; examId: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/periograma/${params.examId}`
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'perio_exams',
      entityId: params.examId,
      route,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    await discardPerioExam(supabase, { tenantId: session.tenantId, examId: params.examId })
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

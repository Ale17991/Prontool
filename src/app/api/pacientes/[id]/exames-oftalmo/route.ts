import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { createOphthalExam, listOphthalExams } from '@/lib/core/ophthalmology-exams/crud'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const f = z.string().trim().max(20).nullable().optional()
const txt = z.string().trim().max(4000).nullable().optional()

const postSchema = z.object({
  av: z.object({ odSc: f, odCc: f, oeSc: f, oeCc: f }).default({}),
  refr: z
    .object({
      od: z.object({ sphere: f, cylinder: f, axis: f }).default({}),
      oe: z.object({ sphere: f, cylinder: f, axis: f }).default({}),
    })
    .default({ od: {}, oe: {} }),
  pio: z.object({ od: f, oe: f }).default({}),
  biomicroscopy: txt,
  fundoscopy: txt,
  notes: txt,
})

export async function GET(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const route = `/api/pacientes/${params.id}/exames-oftalmo`
  try {
    const session = await requireRole(['admin', 'profissional_saude', 'recepcionista'], {
      entity: 'ophthalmology_exams',
      entityId: params.id,
      route,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    const rows = await listOphthalExams(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
    })
    return NextResponse.json({ rows }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/exames-oftalmo`
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'ophthalmology_exams',
      entityId: params.id,
      route,
      request: req,
    })
    const parsed = postSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: { code: 'INVALID_BODY', message: 'Payload inválido', issues: parsed.error.issues },
        },
        { status: 422 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const result = await createOphthalExam(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
      actorUserId: session.userId,
      av: parsed.data.av,
      refr: parsed.data.refr,
      pio: parsed.data.pio,
      biomicroscopy: parsed.data.biomicroscopy ?? null,
      fundoscopy: parsed.data.fundoscopy ?? null,
      notes: parsed.data.notes ?? null,
    })
    return NextResponse.json({ id: result.id }, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

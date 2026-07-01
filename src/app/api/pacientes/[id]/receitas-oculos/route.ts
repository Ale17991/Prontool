import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { createEyeglassRx, listEyeglassRx } from '@/lib/core/eyeglass-prescriptions/crud'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const field = z.string().trim().max(20).nullable().optional()
const eyeSchema = z.object({
  sphere: field,
  cylinder: field,
  axis: field,
  addition: field,
  prism: field,
  base: field,
  dnp: field,
})
const postSchema = z.object({
  od: eyeSchema.default({}),
  oe: eyeSchema.default({}),
  reading_distance: z.string().trim().max(40).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
})

export async function GET(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const route = `/api/pacientes/${params.id}/receitas-oculos`
  try {
    const session = await requireRole(['admin', 'profissional_saude', 'recepcionista'], {
      entity: 'eyeglass_prescriptions',
      entityId: params.id,
      route,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    const rows = await listEyeglassRx(supabase, {
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
  const route = `/api/pacientes/${params.id}/receitas-oculos`
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'eyeglass_prescriptions',
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
    const emptyEye = {
      sphere: null,
      cylinder: null,
      axis: null,
      addition: null,
      prism: null,
      base: null,
      dnp: null,
    }
    const supabase = createSupabaseServiceClient()
    const result = await createEyeglassRx(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
      actorUserId: session.userId,
      od: { ...emptyEye, ...parsed.data.od },
      oe: { ...emptyEye, ...parsed.data.oe },
      readingDistance: parsed.data.reading_distance ?? null,
      notes: parsed.data.notes ?? null,
    })
    return NextResponse.json({ id: result.id }, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

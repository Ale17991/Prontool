import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { deletePatientTag, updatePatientTag } from '@/lib/core/patient-tags/service'
import { PATIENT_TAG_COLORS } from '@/lib/core/patient-tags/palette'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * PATCH  /api/patient-tags/{id} — renomear ou trocar cor.
 * DELETE /api/patient-tags/{id} — remove tag do catálogo (cascateia em
 *                                  patient_tag_assignments).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ALL_ROLES = ['admin', 'financeiro', 'recepcionista', 'profissional_saude'] as const

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(40).optional(),
    color: z.enum(PATIENT_TAG_COLORS).optional(),
  })
  .refine((v) => v.name !== undefined || v.color !== undefined, {
    message: 'Informe name ou color para atualizar.',
  })

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/patient-tags/${params.id}`
  try {
    const session = await requireRole(ALL_ROLES, {
      entity: 'patient_tags',
      entityId: params.id,
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
    const tag = await updatePatientTag(supabase, {
      tenantId: session.tenantId,
      tagId: params.id,
      name: parsed.data.name,
      color: parsed.data.color,
    })
    return NextResponse.json({ tag }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/patient-tags/${params.id}`
  try {
    const session = await requireRole(ALL_ROLES, {
      entity: 'patient_tags',
      entityId: params.id,
      route,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    await deletePatientTag(supabase, {
      tenantId: session.tenantId,
      tagId: params.id,
    })
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

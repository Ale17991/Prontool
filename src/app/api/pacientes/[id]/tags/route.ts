import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import {
  assignTagToPatient,
  listTagsForPatient,
  unassignTagFromPatient,
} from '@/lib/core/patient-tags/service'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * GET    /api/pacientes/{id}/tags        — tags atribuídas ao paciente.
 * POST   /api/pacientes/{id}/tags { tag_id } — atribui tag (idempotente).
 * DELETE /api/pacientes/{id}/tags?tag_id  — remove atribuição.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ALL_ROLES = ['admin', 'financeiro', 'recepcionista', 'profissional_saude'] as const

const assignSchema = z.object({ tag_id: z.string().uuid() })

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/tags`
  try {
    const session = await requireRole(ALL_ROLES, {
      entity: 'patient_tag_assignments',
      entityId: params.id,
      route,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    const tags = await listTagsForPatient(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
    })
    return NextResponse.json({ tags }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/tags`
  try {
    const session = await requireRole(ALL_ROLES, {
      entity: 'patient_tag_assignments',
      entityId: params.id,
      route,
      request: req,
    })
    const parsed = assignSchema.safeParse(await req.json().catch(() => null))
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
    await assignTagToPatient(supabase, {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      patientId: params.id,
      tagId: parsed.data.tag_id,
    })
    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/tags`
  try {
    const session = await requireRole(ALL_ROLES, {
      entity: 'patient_tag_assignments',
      entityId: params.id,
      route,
      request: req,
    })
    const tagId = new URL(req.url).searchParams.get('tag_id')
    if (!tagId || !/^[0-9a-f-]{36}$/i.test(tagId)) {
      return NextResponse.json(
        { error: { code: 'INVALID_QUERY', message: 'tag_id obrigatório' } },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    await unassignTagFromPatient(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
      tagId,
    })
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import {
  createPatientTag,
  listPatientTags,
} from '@/lib/core/patient-tags/service'
import { PATIENT_TAG_COLORS } from '@/lib/core/patient-tags/palette'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * GET  /api/patient-tags — catálogo de tags do tenant.
 * POST /api/patient-tags — cria nova tag.
 *
 * Permissão: qualquer usuário autenticado do tenant.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ALL_ROLES = ['admin', 'financeiro', 'recepcionista', 'profissional_saude'] as const

const createSchema = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.enum(PATIENT_TAG_COLORS),
})

export async function GET(req: Request): Promise<Response> {
  try {
    const session = await requireRole(ALL_ROLES, {
      entity: 'patient_tags',
      route: '/api/patient-tags',
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    const tags = await listPatientTags(supabase, session.tenantId)
    return NextResponse.json({ tags }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route: '/api/patient-tags' })
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const session = await requireRole(ALL_ROLES, {
      entity: 'patient_tags',
      route: '/api/patient-tags',
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
    const tag = await createPatientTag(supabase, {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      name: parsed.data.name,
      color: parsed.data.color,
    })
    return NextResponse.json({ tag }, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route: '/api/patient-tags' })
  }
}

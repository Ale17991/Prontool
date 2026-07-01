import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { listCareNotes, createCareNote, deleteCareNote } from '@/lib/core/patient-portal/care-notes'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * Orientações ao paciente (seção do portal). Clínicos escrevem aqui.
 *  GET    → lista as orientações do paciente
 *  POST   → cria ({ body })
 *  DELETE → remove (?noteId=)
 * RBAC: admin / profissional_saude (recepção não escreve orientação clínica).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ROUTE = '/api/pacientes/[id]/orientacoes'
const ROLES = ['admin', 'profissional_saude'] as const

const createSchema = z.object({ body: z.string().trim().min(1).max(5000) })

export async function GET(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const session = await requireRole(ROLES, {
      entity: 'patient_care_notes',
      route: ROUTE,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    const notes = await listCareNotes(supabase, session.tenantId, params.id)
    return NextResponse.json({ notes }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route: ROUTE })
  }
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const session = await requireRole(ROLES, {
      entity: 'patient_care_notes',
      route: ROUTE,
      request: req,
    })
    const parsed = createSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_BODY',
            message: 'A orientação deve ter entre 1 e 5000 caracteres.',
          },
        },
        { status: 422 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const created = await createCareNote(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
      body: parsed.data.body,
      actorUserId: session.userId,
    })
    return NextResponse.json(created, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route: ROUTE })
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const session = await requireRole(ROLES, {
      entity: 'patient_care_notes',
      route: ROUTE,
      request: req,
    })
    const noteId = new URL(req.url).searchParams.get('noteId')
    if (!noteId) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'noteId obrigatório.' } },
        { status: 422 },
      )
    }
    const supabase = createSupabaseServiceClient()
    await deleteCareNote(supabase, { tenantId: session.tenantId, id: noteId })
    // params.id (paciente) não é usado na deleção — a nota já é escopada por tenant+id.
    void params
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route: ROUTE })
  }
}

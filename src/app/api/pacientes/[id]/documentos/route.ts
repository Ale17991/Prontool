import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { createPatientDocument } from '@/lib/core/patient-documents/create'
import { listPatientDocuments } from '@/lib/core/patient-documents/list'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const postSchema = z.object({
  doc_type: z.enum(['atestado', 'declaracao', 'receita', 'laudo', 'outro']).default('atestado'),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(8000),
  cid_code: z.string().trim().max(16).nullable().optional(),
  cid_description: z.string().trim().max(300).nullable().optional(),
  paper_size: z.enum(['A4', 'A5', 'LETTER']).optional(),
  font_size: z.number().int().min(8).max(18).optional(),
})

export async function GET(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const route = `/api/pacientes/${params.id}/documentos`
  try {
    const session = await requireRole(['admin', 'profissional_saude', 'recepcionista'], {
      entity: 'patient_documents',
      entityId: params.id,
      route,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    const rows = await listPatientDocuments(supabase, {
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
  const route = `/api/pacientes/${params.id}/documentos`
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'patient_documents',
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
    const result = await createPatientDocument(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
      actorUserId: session.userId,
      docType: parsed.data.doc_type,
      title: parsed.data.title,
      body: parsed.data.body,
      cidCode: parsed.data.cid_code ?? null,
      cidDescription: parsed.data.cid_description ?? null,
      paperSize: parsed.data.paper_size,
      fontSize: parsed.data.font_size,
    })
    return NextResponse.json({ id: result.id }, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { updateTemplate, softDeleteTemplate } from '@/lib/core/document-templates/crud'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const upsertSchema = z.object({
  name: z.string().trim().min(1).max(120),
  doc_type: z.enum(['atestado', 'declaracao', 'receita', 'outro']),
  body: z.string().trim().min(1).max(8000),
  paper_size: z.enum(['A4', 'A5', 'LETTER']),
  font_size: z.number().int().min(8).max(18),
})

export async function PUT(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/document-templates/${params.id}`
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'document_templates',
      entityId: params.id,
      route,
      request: req,
    })
    const parsed = upsertSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'Payload inválido', issues: parsed.error.issues } },
        { status: 422 },
      )
    }
    const supabase = createSupabaseServiceClient()
    await updateTemplate(supabase, params.id, {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      name: parsed.data.name,
      docType: parsed.data.doc_type,
      body: parsed.data.body,
      paperSize: parsed.data.paper_size,
      fontSize: parsed.data.font_size,
    })
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/document-templates/${params.id}`
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'document_templates',
      entityId: params.id,
      route,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    await softDeleteTemplate(supabase, {
      tenantId: session.tenantId,
      id: params.id,
      actorUserId: session.userId,
    })
    return new Response(null, { status: 204 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

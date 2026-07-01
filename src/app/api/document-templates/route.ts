import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { listTemplates, createTemplate } from '@/lib/core/document-templates/crud'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const upsertSchema = z.object({
  name: z.string().trim().min(1).max(120),
  doc_type: z.enum(['atestado', 'declaracao', 'receita', 'laudo', 'outro']).default('atestado'),
  body: z.string().trim().min(1).max(8000),
  paper_size: z.enum(['A4', 'A5', 'LETTER']).default('A4'),
  font_size: z.number().int().min(8).max(18).default(11),
})

export async function GET(req: Request): Promise<Response> {
  const route = '/api/document-templates'
  try {
    const session = await requireRole(['admin', 'profissional_saude', 'recepcionista'], {
      entity: 'document_templates',
      route,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    const rows = await listTemplates(supabase, { tenantId: session.tenantId })
    return NextResponse.json({ rows }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

export async function POST(req: Request): Promise<Response> {
  const route = '/api/document-templates'
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'document_templates',
      route,
      request: req,
    })
    const parsed = upsertSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: { code: 'INVALID_BODY', message: 'Payload inválido', issues: parsed.error.issues },
        },
        { status: 422 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const result = await createTemplate(supabase, {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      name: parsed.data.name,
      docType: parsed.data.doc_type,
      body: parsed.data.body,
      paperSize: parsed.data.paper_size,
      fontSize: parsed.data.font_size,
    })
    return NextResponse.json({ id: result.id }, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

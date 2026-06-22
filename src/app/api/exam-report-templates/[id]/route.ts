import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import {
  softDeleteExamReportTemplate,
  updateExamReportTemplate,
} from '@/lib/core/exam-report-templates/crud'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const upsertSchema = z.object({
  exam_type: z.enum(['oftalmologico']).default('oftalmologico'),
  name: z.string().trim().min(1).max(120),
  header_text: z.string().trim().max(4000).nullable().optional(),
  conclusion_text: z.string().trim().max(8000).nullable().optional(),
  footer_text: z.string().trim().max(2000).nullable().optional(),
  is_default: z.boolean().default(false),
})

export async function PUT(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/exam-report-templates/${params.id}`
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'exam_report_templates',
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
    await updateExamReportTemplate(supabase, params.id, {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      examType: parsed.data.exam_type,
      name: parsed.data.name,
      headerText: parsed.data.header_text ?? null,
      conclusionText: parsed.data.conclusion_text ?? null,
      footerText: parsed.data.footer_text ?? null,
      isDefault: parsed.data.is_default,
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
  const route = `/api/exam-report-templates/${params.id}`
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'exam_report_templates',
      entityId: params.id,
      route,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    await softDeleteExamReportTemplate(supabase, {
      tenantId: session.tenantId,
      id: params.id,
      actorUserId: session.userId,
    })
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

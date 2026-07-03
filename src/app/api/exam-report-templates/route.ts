import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import {
  createExamReportTemplate,
  listExamReportTemplates,
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

export async function GET(req: Request): Promise<Response> {
  const route = '/api/exam-report-templates'
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'exam_report_templates',
      route,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    const rows = await listExamReportTemplates(supabase, { tenantId: session.tenantId })
    return NextResponse.json({ rows }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

export async function POST(req: Request): Promise<Response> {
  const route = '/api/exam-report-templates'
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'exam_report_templates',
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
    const result = await createExamReportTemplate(supabase, {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      examType: parsed.data.exam_type,
      name: parsed.data.name,
      headerText: parsed.data.header_text ?? null,
      conclusionText: parsed.data.conclusion_text ?? null,
      footerText: parsed.data.footer_text ?? null,
      isDefault: parsed.data.is_default,
    })
    return NextResponse.json({ id: result.id }, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

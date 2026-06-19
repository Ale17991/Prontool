import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { listPlanReceivables, type ReceiptStatus } from '@/lib/core/plan-receivables/list'
import { setPlanReceiptStatus } from '@/lib/core/plan-receivables/set-status'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const STATUS = z.enum(['pendente', 'recebido', 'glosado', 'nao_recebido'])

export async function GET(req: Request): Promise<Response> {
  const route = '/api/financeiro/recebiveis-convenio'
  try {
    const session = await requireRole(['admin', 'financeiro'], {
      entity: 'plan_procedure_receipts',
      route,
      request: req,
    })
    const sp = new URL(req.url).searchParams
    const from = sp.get('from')
    const to = sp.get('to')
    if (!from || !to || !DATE.test(from) || !DATE.test(to)) {
      return NextResponse.json(
        { error: { code: 'INVALID_QUERY', message: 'from e to obrigatórios (YYYY-MM-DD)' } },
        { status: 400 },
      )
    }
    const planId = sp.get('plan')
    const statusRaw = sp.get('status')
    const status = statusRaw && STATUS.safeParse(statusRaw).success ? (statusRaw as ReceiptStatus) : 'all'

    const supabase = createSupabaseServiceClient()
    const rows = await listPlanReceivables(supabase, {
      tenantId: session.tenantId,
      from,
      to,
      planId: planId || null,
      status,
      encryptionKey: process.env.PATIENT_DATA_ENCRYPTION_KEY,
    })
    return NextResponse.json({ rows }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

const postSchema = z.object({
  procedure_line_ids: z.array(z.string().uuid()).min(1).max(500),
  status: STATUS,
  received_at: z.string().regex(DATE).nullable().optional(),
})

export async function POST(req: Request): Promise<Response> {
  const route = '/api/financeiro/recebiveis-convenio'
  try {
    const session = await requireRole(['admin', 'financeiro'], {
      entity: 'plan_procedure_receipts',
      route,
      request: req,
    })
    const parsed = postSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'Payload inválido', issues: parsed.error.issues } },
        { status: 422 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const result = await setPlanReceiptStatus(supabase, {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      procedureLineIds: parsed.data.procedure_line_ids,
      status: parsed.data.status,
      receivedAt: parsed.data.received_at ?? null,
    })
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

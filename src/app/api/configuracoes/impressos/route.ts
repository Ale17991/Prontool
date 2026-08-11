import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { toHttpResponse } from '@/lib/observability/http'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getPrintoutConfig, updatePrintoutConfig } from '@/lib/core/printouts/config'
import { PRINTOUT_DOCUMENTS, PRINTOUT_PATIENT_FIELDS } from '@/lib/core/printouts/fields'

/**
 * `/api/configuracoes/impressos` — quais dados do paciente saem nos impressos.
 *
 *   GET → configuração atual + catálogos (campos e documentos), para a tela não
 *         precisar duplicar as listas que vivem em `printouts/fields.ts`.
 *   PUT → grava padrão e exceções. Uma linha de audit_log por gravação.
 *
 * Admin-only: a decisão é da clínica, e é ela que responde pelo que sai em
 * papel com PII do paciente.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ROUTE = '/api/configuracoes/impressos'

export async function GET(req: Request): Promise<Response> {
  try {
    const session = await requireRole(['admin'], {
      entity: 'tenant_clinic_profile',
      route: ROUTE,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    const config = await getPrintoutConfig(supabase, session.tenantId)
    return NextResponse.json({
      config,
      catalog: { fields: PRINTOUT_PATIENT_FIELDS, documents: PRINTOUT_DOCUMENTS },
    })
  } catch (err) {
    return toHttpResponse(err, { route: ROUTE, method: 'GET' })
  }
}

export async function PUT(req: Request): Promise<Response> {
  try {
    const session = await requireRole(['admin'], {
      entity: 'tenant_clinic_profile',
      route: ROUTE,
      request: req,
    })
    const body = (await req.json()) as { fields?: unknown; overrides?: unknown }
    const supabase = createSupabaseServiceClient()
    const config = await updatePrintoutConfig(supabase, {
      tenantId: session.tenantId,
      fields: body.fields,
      overrides: body.overrides,
      actorUserId: session.userId,
    })
    return NextResponse.json({ config })
  } catch (err) {
    return toHttpResponse(err, { route: ROUTE, method: 'PUT' })
  }
}

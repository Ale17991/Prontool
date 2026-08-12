/**
 * Feature 056 — prévia: quantos pacientes este gatilho atinge hoje (FR-014).
 *
 * Roda a MESMA enumeração do motor. Prévia com consulta própria divergiria no
 * primeiro ajuste de regra, e prévia que mente é pior que nenhuma — é sobre
 * ela que a clínica decide ativar.
 */
import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { toHttpResponse } from '@/lib/observability/http'
import { hasAutomationsModule, moduleDisabled } from '@/lib/core/automations/gate'
import { previewTrigger } from '@/lib/core/automations/preview'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const route = `/api/automacoes/gatilhos/${params.id}/previa`
  try {
    const session = await requireRole(['admin'], {
      entity: 'automation_triggers',
      entityId: params.id,
      route,
      request: req,
    })
    if (!(await hasAutomationsModule(session.tenantId))) return moduleDisabled()

    try {
      const previa = await previewTrigger(createSupabaseServiceClient(), session.tenantId, params.id)
      return NextResponse.json(previa, { status: 200 })
    } catch (e) {
      if (e instanceof Error && e.message === 'GATILHO_NAO_ENCONTRADO') {
        return NextResponse.json({ error: 'GATILHO_NAO_ENCONTRADO' }, { status: 404 })
      }
      if (e instanceof Error && e.message === 'FONTE_DESCONHECIDA') {
        return NextResponse.json({ error: 'FONTE_DESCONHECIDA' }, { status: 400 })
      }
      throw e
    }
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

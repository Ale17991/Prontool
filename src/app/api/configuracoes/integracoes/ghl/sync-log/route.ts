import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { toHttpResponse } from '@/lib/observability/http'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { listRecentSyncLog } from '@/lib/core/integrations/ghl/sync-log'

/**
 * Feature 008 — `GET /api/configuracoes/integracoes/ghl/sync-log`
 *
 * Retorna últimas 10 entradas de `integration_sync_log` para o tenant
 * da sessão. Qualquer papel autenticado pode ler (UI esconde para não-admin).
 * `detail` já é gravado com PII mascarada (ver `mask-pii.ts`).
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request): Promise<Response> {
  const route = '/api/configuracoes/integracoes/ghl/sync-log'
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      { entity: 'integration_sync_log', route, request: req },
    )
    const supabase = createSupabaseServiceClient()
    const items = await listRecentSyncLog(supabase, session.tenantId, 10)
    return NextResponse.json(
      {
        items: items.map((row) => ({
          id: row.id,
          occurred_at: row.occurred_at,
          kind: row.kind,
          status: row.status,
          error_code: row.error_code,
          error_message: row.error_message,
          summary: summarize(row),
        })),
      },
      { status: 200 },
    )
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

function summarize(row: {
  kind: string
  status: string
  error_code: string | null
  detail: unknown
}): string | null {
  if (row.status === 'failure') {
    return row.error_code ? `Falha: ${row.error_code}` : 'Falha de sincronização'
  }
  switch (row.kind) {
    case 'connect':
      return 'Integração conectada'
    case 'disconnect':
      return 'Integração desconectada'
    case 'token_refresh':
      return 'Token renovado com sucesso'
    case 'outbound_contact':
      return 'Paciente sincronizado para o GHL'
    case 'outbound_note':
      return 'Atendimento registrado como nota no GHL'
    case 'outbound_update':
      return 'Paciente atualizado no GHL'
    case 'inbound_contact':
      return 'Contato recebido do GHL'
    case 'inbound_opportunity':
      return 'Oportunidade recebida do GHL'
    case 'custom_field_setup':
      return 'Custom field configurado'
    case 'webhook_setup':
      return 'Webhook registrado'
    case 'custom_menu_setup':
      return 'Custom menu configurado'
    default:
      return null
  }
}

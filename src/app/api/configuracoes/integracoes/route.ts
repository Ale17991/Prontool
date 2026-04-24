import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getEnabledIntegrations } from '@/lib/core/integrations/config'
import { listAdapters } from '@/lib/integrations/registry'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * GET /api/configuracoes/integracoes — admin-only list of every registered
 * provider with its connection status for this tenant. Providers that are
 * registered but not connected appear with connected=false so the UI can
 * render them as "Conectar" cards.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request): Promise<Response> {
  try {
    const session = await requireRole(['admin'], {
      entity: 'tenant_integrations',
      route: '/api/configuracoes/integracoes',
      request: req,
    })

    const supabase = createSupabaseServiceClient()
    const enabled = await getEnabledIntegrations(supabase, session.tenantId)
    const byProvider = new Map(enabled.map((r) => [r.provider, r]))

    const adapters = listAdapters()
    const integrations = adapters
      .map((a) => {
        const row = byProvider.get(a.provider)
        return {
          provider: a.provider,
          label: a.label,
          description: a.description,
          connected: Boolean(row),
          enabled: row?.enabled ?? false,
          connected_since: row?.created_at ?? null,
        }
      })
      .sort((a, b) => {
        if (a.connected && !b.connected) return -1
        if (!a.connected && b.connected) return 1
        return a.label.localeCompare(b.label)
      })

    return NextResponse.json({ integrations }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route: '/api/configuracoes/integracoes' })
  }
}

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { toHttpResponse } from '@/lib/observability/http'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { disconnectGhlTenant } from '@/lib/core/integrations/ghl/disconnect-tenant'
import { getIntegrationConfig } from '@/lib/core/integrations/config'

/**
 * Feature 008 — `/api/configuracoes/integracoes/ghl` (rota estática que
 * sobrescreve o catch-all `[provider]` legado da Feature 002 para GHL).
 *
 * Esta versão DELETE marca `enabled=false, status='disconnected'` em vez
 * de apagar a row, para preservar audit trail e permitir Reconectar
 * rápido. Cleanup de webhooks/menu remoto é best-effort.
 *
 * GET (status com custom_fields/webhooks/menu_status) e POST (reconfigure
 * sem credentials) entram em US4 (T045/T046).
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const deleteBodySchema = z.object({
  reason: z.string().trim().max(500).optional(),
})

export async function DELETE(req: Request): Promise<Response> {
  const route = '/api/configuracoes/integracoes/ghl'
  try {
    const session = await requireRole(['admin'], {
      entity: 'tenant_integrations',
      route,
      request: req,
    })

    let parsedReason: string | undefined
    if (req.body) {
      try {
        const raw = await req.json().catch(() => ({}))
        const parsed = deleteBodySchema.safeParse(raw)
        if (parsed.success) parsedReason = parsed.data.reason
      } catch {
        // Ignora — body opcional.
      }
    }

    const supabase = createSupabaseServiceClient()
    const row = await getIntegrationConfig(supabase, session.tenantId, 'ghl')
    if (!row) {
      return NextResponse.json(
        { error: { code: 'NOT_CONNECTED', message: 'Sem integração GHL para desconectar.' } },
        { status: 404 },
      )
    }

    const result = await disconnectGhlTenant({
      supabase,
      source: 'manual_disconnect',
      actorUserId: session.userId,
      actorLabel: 'admin',
      tenantId: session.tenantId,
      reason: parsedReason,
    })

    if (result.cleanupRemaining.length > 0) {
      // Linha já está disconnected; sinalizamos pendência ao admin.
      return NextResponse.json(
        {
          ok: true,
          warning: 'PARTIAL_CLEANUP',
          cleanup_remaining: result.cleanupRemaining,
        },
        { status: 200 },
      )
    }
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

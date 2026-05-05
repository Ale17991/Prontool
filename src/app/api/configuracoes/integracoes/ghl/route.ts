import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { getSession } from '@/lib/auth/get-session'
import { getSessionFromRequest } from '@/lib/auth/get-session-from-request'
import { toHttpResponse } from '@/lib/observability/http'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { disconnectGhlTenant } from '@/lib/core/integrations/ghl/disconnect-tenant'
import { getIntegrationConfig } from '@/lib/core/integrations/config'
import { recordIntegrationEvent } from '@/lib/core/audit/integration-events'
import { ghlAdapter } from '@/lib/integrations/ghl/adapter'
import { listRecentSyncLog } from '@/lib/core/integrations/ghl/sync-log'
import {
  GHL_CUSTOM_FIELD_DEFINITIONS,
  GHL_CUSTOM_FIELD_SLUGS,
  type GhlConfigV2,
  type GhlCustomFieldSlug,
} from '@/lib/integrations/ghl/oauth/types'

/**
 * Feature 008 — `/api/configuracoes/integracoes/ghl`
 *
 *   GET    → status (`not_connected | connected | token_expired |
 *            disconnected`), sub_account_name, connected_at, custom_fields,
 *            webhooks, menu_status, last_sync_at, scopes. NUNCA expõe tokens.
 *   POST   → reconfigure não-credencial (campos legacy field_map_*) — admin only.
 *   DELETE → desconectar (admin only). Marca enabled=false, preserva creds.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const deleteBodySchema = z.object({
  reason: z.string().trim().max(500).optional(),
})

const reconfigureBodySchema = z.object({
  trigger_stage_name: z.string().trim().max(100).optional(),
  field_map_plano: z.string().trim().max(60).optional(),
  field_map_procedimento_tuss: z.string().trim().max(60).optional(),
  field_map_profissional: z.string().trim().max(60).optional(),
  field_map_valor: z.string().trim().max(60).optional(),
  sso_auto_provisioning: z.boolean().optional(),
})

export async function GET(req: Request): Promise<Response> {
  const route = '/api/configuracoes/integracoes/ghl'
  try {
    const session = (await getSessionFromRequest(req)) ?? (await getSession())
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHENTICATED' } },
        { status: 401 },
      )
    }

    const supabase = createSupabaseServiceClient()
    const row = await getIntegrationConfig(supabase, session.tenantId, 'ghl')

    if (!row) {
      return NextResponse.json(
        {
          status: 'not_connected',
          sub_account_name: null,
          location_id: null,
          timezone: null,
          connected_at: null,
          scopes: null,
          custom_fields: [],
          webhooks: [],
          menu_status: 'not_attempted',
          warnings: [],
          last_sync_at: null,
        },
        { status: 200 },
      )
    }

    const config = (row.config ?? {}) as Partial<GhlConfigV2>
    const status =
      row.enabled === false
        ? 'disconnected'
        : ((row as unknown as { status?: string }).status ?? 'connected')
    const customFields = buildCustomFieldsListing(config.custom_field_ids ?? {})
    const webhooks = Object.entries(config.webhook_ids ?? {})
      .filter(([, id]) => Boolean(id))
      .map(([event, id]) => ({ event, id: String(id) }))

    // last_sync_at do registro mais recente em integration_sync_log.
    const lastSync = await listRecentSyncLog(supabase, session.tenantId, 1)
    const lastSyncAt = lastSync[0]?.occurred_at ?? null

    return NextResponse.json(
      {
        status,
        sub_account_name: config.sub_account_name ?? null,
        location_id: config.location_id ?? null,
        timezone: config.timezone ?? null,
        connected_at: (row as unknown as { connected_at?: string }).connected_at ?? null,
        scopes: null, // não vazamos os escopos exatos das credentials_enc
        custom_fields: customFields,
        webhooks,
        menu_status: config.menu_status ?? 'not_attempted',
        warnings: [],
        last_sync_at: lastSyncAt,
      },
      { status: 200 },
    )
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

export async function POST(req: Request): Promise<Response> {
  const route = '/api/configuracoes/integracoes/ghl'
  try {
    const session = await requireRole(['admin'], {
      entity: 'tenant_integrations',
      route,
      request: req,
    })

    const raw = await req.json().catch(() => null)
    const parsed = reconfigureBodySchema.safeParse(raw ?? {})
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', issues: parsed.error.issues } },
        { status: 400 },
      )
    }

    const supabase = createSupabaseServiceClient()
    const row = await getIntegrationConfig(supabase, session.tenantId, 'ghl')
    if (!row) {
      return NextResponse.json(
        { error: { code: 'NOT_CONNECTED' } },
        { status: 404 },
      )
    }

    const before = (row.config ?? {}) as Record<string, unknown>
    const merged = { ...before, ...parsed.data }
    const { error: updErr } = await supabase
      .from('tenant_integrations')
      .update({ config: merged as never })
      .eq('tenant_id', session.tenantId)
      .eq('provider', 'ghl')
    if (updErr) throw new Error(`reconfigure update failed: ${updErr.message}`)

    try {
      await recordIntegrationEvent(supabase, {
        type: 'integration.reconfigure',
        tenantId: session.tenantId,
        provider: 'ghl',
        actorUserId: session.userId,
        actorLabel: 'admin',
        adapter: ghlAdapter,
        before: { config: before, credentials: null },
        after: { config: merged, credentials: null },
        reason: 'reconfigure (non-credentials)',
      })
    } catch {
      // não bloqueia a resposta do reconfigure se audit falhar.
    }

    return NextResponse.json({ ok: true, config: merged }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

function buildCustomFieldsListing(
  ids: GhlConfigV2['custom_field_ids'],
): Array<{ slug: GhlCustomFieldSlug; name: string; id: string; alias: string }> {
  const out: Array<{ slug: GhlCustomFieldSlug; name: string; id: string; alias: string }> = []
  for (const slug of GHL_CUSTOM_FIELD_SLUGS) {
    const entry = ids?.[slug]
    if (entry?.id) {
      out.push({
        slug,
        name: GHL_CUSTOM_FIELD_DEFINITIONS[slug].name,
        id: entry.id,
        alias: entry.alias,
      })
    }
  }
  return out
}

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

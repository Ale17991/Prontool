import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getAdapter } from '@/lib/integrations/registry'
import { getIntegrationConfig } from '@/lib/core/integrations/config'
import { decryptCredentials, encryptCredentials } from '@/lib/core/integrations/credentials'
import { recordIntegrationEvent } from '@/lib/core/audit/integration-events'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * GET/POST/DELETE /api/configuracoes/integracoes/[provider] — admin only.
 *
 *   GET    → status + redacted config; never returns credentials in claro.
 *   POST   → UPSERT row with encrypted credentials; audit connect/reconfigure.
 *   DELETE → remove row; audit disconnect.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const postBodySchema = z.object({
  config: z.unknown(),
  credentials: z.unknown(),
  enabled: z.boolean().optional(),
  reason: z.string().trim().min(3).max(500),
})

const deleteBodySchema = z.object({
  reason: z.string().trim().min(3).max(500),
})

type Params = { params: { provider: string } }

export async function GET(req: Request, { params }: Params): Promise<Response> {
  const route = `/api/configuracoes/integracoes/${params.provider}`
  try {
    const session = await requireRole(['admin'], {
      entity: 'tenant_integrations',
      route,
      request: req,
    })
    const adapter = getAdapter(params.provider)
    if (!adapter) {
      return NextResponse.json(
        { error: { code: 'PROVIDER_NOT_FOUND', message: 'Provider desconhecido' } },
        { status: 404 },
      )
    }

    const supabase = createSupabaseServiceClient()
    const row = await getIntegrationConfig(supabase, session.tenantId, adapter.provider)

    const base = {
      provider: adapter.provider,
      label: adapter.label,
      description: adapter.description,
      config_schema: zodToJsonSchema(adapter.configSchema),
      credentials_schema: zodToJsonSchema(adapter.credentialsSchema),
    }

    if (!row) {
      return NextResponse.json({ ...base, connected: false }, { status: 200 })
    }

    let credentialsRedacted: Record<string, string> = {}
    try {
      const creds = await decryptCredentials(supabase, row, adapter.credentialsSchema)
      credentialsRedacted = adapter.redactCredentials(creds)
    } catch {
      // Cannot decrypt (e.g., legacy backfill placeholder). Still report connected
      // with empty redacted map so the UI can prompt a reconfigure.
      credentialsRedacted = {}
    }

    return NextResponse.json(
      {
        ...base,
        connected: true,
        enabled: row.enabled,
        connected_since: row.created_at,
        config: row.config,
        credentials_redacted: credentialsRedacted,
      },
      { status: 200 },
    )
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

export async function POST(req: Request, { params }: Params): Promise<Response> {
  const route = `/api/configuracoes/integracoes/${params.provider}`
  try {
    const session = await requireRole(['admin'], {
      entity: 'tenant_integrations',
      route,
      request: req,
    })
    const adapter = getAdapter(params.provider)
    if (!adapter) {
      return NextResponse.json(
        { error: { code: 'PROVIDER_NOT_FOUND', message: 'Provider desconhecido' } },
        { status: 404 },
      )
    }

    const body = await req.json().catch(() => null)
    const parsed = postBodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_BODY',
            message: 'Payload inválido',
            issues: parsed.error.issues,
          },
        },
        { status: 400 },
      )
    }

    const configParsed = adapter.configSchema.safeParse(parsed.data.config)
    if (!configParsed.success) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_BODY',
            message: 'Config inválida para este provider',
            issues: configParsed.error.issues,
          },
        },
        { status: 400 },
      )
    }

    const credsParsed = adapter.credentialsSchema.safeParse(parsed.data.credentials)
    if (!credsParsed.success) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_BODY',
            message: 'Credentials inválidas para este provider',
            issues: credsParsed.error.issues,
          },
        },
        { status: 400 },
      )
    }

    const supabase = createSupabaseServiceClient()

    // Load previous row BEFORE upsert so audit captures before/after.
    const existing = await getIntegrationConfig(supabase, session.tenantId, adapter.provider)
    let existingCreds: unknown | null = null
    if (existing) {
      try {
        existingCreds = await decryptCredentials(supabase, existing, adapter.credentialsSchema)
      } catch {
        existingCreds = null
      }
    }

    const credentialsEnc = await encryptCredentials(supabase, credsParsed.data)

    // Extract webhook secret for its dedicated column when the credentials schema
    // carries one (GHL does via `inbound_webhook_secret`).
    const credsObj = credsParsed.data as Record<string, unknown>
    let webhookSecretEnc: string | null = null
    if (typeof credsObj.inbound_webhook_secret === 'string') {
      webhookSecretEnc = await encryptCredentials(supabase, credsObj.inbound_webhook_secret)
    }

    const upsert = await supabase
      .from('tenant_integrations')
      .upsert(
        {
          tenant_id: session.tenantId,
          provider: adapter.provider,
          config: configParsed.data as never,
          credentials_enc: credentialsEnc as unknown as string,
          webhook_secret_enc: webhookSecretEnc as unknown as string | null,
          enabled: parsed.data.enabled ?? true,
          created_by_user_id: session.userId,
        },
        { onConflict: 'tenant_id,provider' },
      )
      .select('created_at')
      .single()

    if (upsert.error || !upsert.data) {
      throw new Error(`tenant_integrations upsert failed: ${upsert.error?.message}`)
    }

    const ip = req.headers.get('x-forwarded-for') ?? null
    const userAgent = req.headers.get('user-agent') ?? null
    await recordIntegrationEvent(supabase, {
      type: existing ? 'integration.reconfigure' : 'integration.connect',
      tenantId: session.tenantId,
      provider: adapter.provider,
      actorUserId: session.userId,
      actorLabel: session.email ? `user:${session.email}` : null,
      adapter,
      before: existing
        ? { config: existing.config, credentials: existingCreds }
        : null,
      after: { config: configParsed.data, credentials: credsParsed.data },
      reason: parsed.data.reason,
      ip,
      userAgent,
    })

    return NextResponse.json(
      {
        provider: adapter.provider,
        connected: true,
        action: existing ? 'reconfigured' : 'connected',
        connected_since: upsert.data.created_at,
      },
      { status: existing ? 200 : 201 },
    )
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

export async function DELETE(req: Request, { params }: Params): Promise<Response> {
  const route = `/api/configuracoes/integracoes/${params.provider}`
  try {
    const session = await requireRole(['admin'], {
      entity: 'tenant_integrations',
      route,
      request: req,
    })
    const adapter = getAdapter(params.provider)
    if (!adapter) {
      return NextResponse.json(
        { error: { code: 'PROVIDER_NOT_FOUND', message: 'Provider desconhecido' } },
        { status: 404 },
      )
    }

    const body = await req.json().catch(() => null)
    const parsed = deleteBodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_BODY',
            message: 'reason é obrigatório',
            issues: parsed.error.issues,
          },
        },
        { status: 400 },
      )
    }

    const supabase = createSupabaseServiceClient()
    const existing = await getIntegrationConfig(supabase, session.tenantId, adapter.provider)
    if (!existing) {
      return NextResponse.json(
        { provider: adapter.provider, connected: false, action: 'noop' },
        { status: 200 },
      )
    }

    let existingCreds: unknown | null = null
    try {
      existingCreds = await decryptCredentials(supabase, existing, adapter.credentialsSchema)
    } catch {
      existingCreds = null
    }

    const del = await supabase
      .from('tenant_integrations')
      .delete()
      .eq('tenant_id', session.tenantId)
      .eq('provider', adapter.provider)
    if (del.error) {
      throw new Error(`tenant_integrations delete failed: ${del.error.message}`)
    }

    const ip = req.headers.get('x-forwarded-for') ?? null
    const userAgent = req.headers.get('user-agent') ?? null
    await recordIntegrationEvent(supabase, {
      type: 'integration.disconnect',
      tenantId: session.tenantId,
      provider: adapter.provider,
      actorUserId: session.userId,
      actorLabel: session.email ? `user:${session.email}` : null,
      adapter,
      before: { config: existing.config, credentials: existingCreds },
      after: null,
      reason: parsed.data.reason,
      ip,
      userAgent,
    })

    return NextResponse.json(
      { provider: adapter.provider, connected: false, action: 'disconnected' },
      { status: 200 },
    )
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

/**
 * Minimal zod → JSON Schema converter good enough to power the dynamic
 * form UI. Only the shapes we actually use in GHL's config/credentials
 * are supported; other providers' shapes expand this function.
 */
function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    const shape = (schema as z.ZodObject<z.ZodRawShape>).shape
    const properties: Record<string, unknown> = {}
    const required: string[] = []
    for (const [key, def] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(def as z.ZodTypeAny)
      if (!(def instanceof z.ZodOptional) && !(def instanceof z.ZodDefault)) {
        required.push(key)
      }
    }
    return { type: 'object', properties, required }
  }
  if (schema instanceof z.ZodString) {
    const checks = (schema as z.ZodString)._def.checks
    const out: Record<string, unknown> = { type: 'string' }
    for (const c of checks) {
      if (c.kind === 'min') out.minLength = c.value
      if (c.kind === 'max') out.maxLength = c.value
      if (c.kind === 'regex') out.pattern = c.regex.source
    }
    return out
  }
  if (schema instanceof z.ZodBoolean) return { type: 'boolean' }
  if (schema instanceof z.ZodNumber) return { type: 'number' }
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodDefault) {
    return zodToJsonSchema((schema as any)._def.innerType)
  }
  return { type: 'string' }
}

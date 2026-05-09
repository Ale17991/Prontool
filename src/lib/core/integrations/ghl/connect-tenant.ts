import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/lib/db/types'
import { logger } from '@/lib/observability/logger'
import { ConflictError } from '@/lib/observability/errors'
import { encryptCredentials } from '@/lib/core/integrations/credentials'
import { recordSimpleIntegrationEvent } from '@/lib/core/audit/integration-events'
import { recordSyncSuccess, recordSyncFailure } from './sync-log'
import { runPostConnectSetup } from './post-connect-setup'
import {
  assertGhlBindingFree,
  GHL_LOCATION_ALREADY_BOUND,
  GHL_TENANT_ALREADY_CONNECTED,
  FR002_MESSAGE,
} from './binding-check'
import {
  ghlConfigV2Schema,
  type GhlConfigV2,
  type GhlOAuthCredentials,
} from '@/lib/integrations/ghl/oauth/types'

/**
 * Feature 008 — Único caminho de criação/atualização da linha
 * `tenant_integrations(provider='ghl')`. Consumido tanto pelo callback
 * OAuth manual (US1) quanto pelo webhook INSTALL do Marketplace (US2).
 *
 * Recebe **sempre** um service-role client porque (a) Marketplace install
 * roda fora de sessão de usuário, (b) o caminho manual escreve `enabled`
 * e `status` que RLS de admin já permite mas o caller pode estar usando
 * service-role para também criar linha em `tenants` no fluxo install.
 */

export type ConnectSource = 'manual_connect' | 'marketplace_install'

export interface ConnectGhlTenantInput {
  /** Service-role client (caller MUST autenticar antes via requireRole/HMAC). */
  supabase: SupabaseClient<Database>
  source: ConnectSource
  /** Para `manual_connect` é o user_id do admin; para install é literal `system:ghl_marketplace_install`. */
  actorUserId: string | null
  actorLabel: string
  /** Tenant alvo. Em install pode ser null inicialmente — caller resolve via location_id antes de chamar. */
  tenantId: string
  /** Credentials OAuth recém-trocados. */
  credentials: GhlOAuthCredentials
  /** Metadata da location (extraída do payload de install OU fetch posterior em manual). */
  location: {
    id: string
    name: string
    timezone: string | null
  }
  /** Para audit (manual_connect). */
  ip?: string | null
  userAgent?: string | null
  /**
   * Quando `true` (apenas em install), tenta criar `tenants` primeiro se ainda
   * não existir. Caller cuida de resolver `tenantId` antes de chamar.
   */
  ensureTenantExists?: boolean
}

export interface ConnectGhlTenantResult {
  tenantId: string
  warnings: string[]
}

const PROVIDER = 'ghl' as const

export async function connectGhlTenant(
  input: ConnectGhlTenantInput,
): Promise<ConnectGhlTenantResult> {
  const supabase = input.supabase

  // Feature 010 (US1) — Pre-flight da regra GHL 1:1 ANTES de qualquer
  // escrita (incluindo ensureTenantRow). Garante que rejeição em
  // marketplace_install não deixa tenant orphan. Race condition residual
  // entre o pre-flight e o upsert é coberta pela UNIQUE INDEX parcial
  // (try/catch no upsert).
  try {
    await assertGhlBindingFree(supabase, {
      tenantId: input.tenantId,
      locationId: input.location.id,
    })
  } catch (err) {
    if (err instanceof ConflictError) {
      // Para rejeições de install (tenant ainda não existe), audit_log
      // requer tenant_id NOT NULL — pulamos o registro no helper e o
      // caller (handler do install) faz o audit do lado dele se quiser.
      // Em manual_connect, o tenant existe e o audit é gravado.
      const tenantExists = await tenantRowExists(supabase, input.tenantId)
      if (tenantExists) {
        await recordRejectionAudit(supabase, input, err.code).catch((auditErr) => {
          logger.error(
            { err: auditErr, tenant_id: input.tenantId },
            'connect-tenant-rejection-audit-failed',
          )
        })
      }
    }
    throw err
  }

  if (input.ensureTenantExists) {
    await ensureTenantRow(supabase, input.tenantId, input.location)
  }

  // Carrega config existente (se houver) para preservar campos legacy
  // (trigger_stage_name etc. da Feature 002).
  const { data: existingRow } = await supabase
    .from('tenant_integrations')
    .select('config, status, enabled')
    .eq('tenant_id', input.tenantId)
    .eq('provider', PROVIDER)
    .maybeSingle()

  const existingConfig = (existingRow?.config ?? {}) as Record<string, unknown>
  const previousStatus = existingRow
    ? ((existingRow as unknown as { status: string }).status ?? 'connected')
    : null

  const newConfig: GhlConfigV2 = ghlConfigV2Schema.parse({
    ...existingConfig,
    location_id: input.location.id,
    sub_account_name: input.location.name,
    timezone: input.location.timezone,
    // OAuth-managed; preserva mapeamentos atuais se já existirem.
    custom_field_ids:
      ((existingConfig.custom_field_ids as Record<string, unknown>) ?? {}),
    webhook_ids:
      ((existingConfig.webhook_ids as Record<string, unknown>) ?? {}),
    menu_id: (existingConfig.menu_id as string | null) ?? null,
    menu_status:
      ((existingConfig.menu_status as
        | 'registered'
        | 'unsupported'
        | 'failed'
        | 'not_attempted'
        | undefined) ?? 'not_attempted'),
    sso_auto_provisioning:
      (existingConfig.sso_auto_provisioning as boolean | undefined) ?? false,
  })

  const credsEnc = await encryptCredentials(supabase, input.credentials)

  // UPSERT: PK é (tenant_id, provider), então on conflict atualiza.
  const upsertPayload = {
    tenant_id: input.tenantId,
    provider: PROVIDER,
    config: newConfig as unknown as Json,
    credentials_enc: credsEnc,
    enabled: true,
    status: 'connected',
    connected_at: new Date().toISOString(),
    // Migration 0063 tornou created_by_user_id nullable. Em manual_connect
    // gravamos o user_id do admin; em marketplace_install fica null e a
    // origem fica em audit_log.actor_label.
    created_by_user_id: input.actorUserId,
  }
  const { error: upsertErr } = await supabase
    .from('tenant_integrations')
    .upsert(upsertPayload, { onConflict: 'tenant_id,provider' })
  if (upsertErr) {
    // Race: outro request inseriu uma row para a mesma location_id entre
    // o pre-flight e o upsert. UNIQUE INDEX parcial em (location_id) WHERE
    // provider='ghl' AND enabled=true rejeita com 23505. Mapeamos para
    // o ConflictError de FR-002 para mensagem consistente.
    if (upsertErr.code === '23505' && /location_id/i.test(upsertErr.message)) {
      const conflict = new ConflictError(GHL_LOCATION_ALREADY_BOUND, FR002_MESSAGE, {
        location_id: input.location.id,
      })
      await recordRejectionAudit(supabase, input, conflict.code).catch((auditErr) => {
        logger.error(
          { err: auditErr, tenant_id: input.tenantId },
          'connect-tenant-rejection-audit-failed',
        )
      })
      throw conflict
    }
    throw new Error(`connectGhlTenant upsert failed: ${upsertErr.message}`)
  }

  // Audit
  try {
    await recordSimpleIntegrationEvent(supabase, {
      type: 'integration.connect',
      tenantId: input.tenantId,
      provider: PROVIDER,
      actorUserId: input.actorUserId,
      actorLabel: input.actorLabel,
      reason:
        input.source === 'marketplace_install'
          ? 'GHL Marketplace install webhook'
          : 'admin clicked Conectar',
      detail: {
        source: input.source,
        location_id: input.location.id,
        sub_account_name: input.location.name,
        previous_status: previousStatus,
        scopes: input.credentials.scopes,
      },
      ip: input.ip,
      userAgent: input.userAgent,
    })
  } catch (err) {
    logger.error(
      { err, tenant_id: input.tenantId },
      'connect-tenant-audit-failed',
    )
  }

  // Sync log: sucesso de connect
  await recordSyncSuccess(supabase, input.tenantId, {
    kind: 'connect',
    detail: { source: input.source, location_id: input.location.id },
  })

  // Post-connect setup roda em background em produção (não bloqueia
  // callback/install). Em testes (`NODE_ENV=test`) aguardamos para
  // evitar Promise leakage entre testes — o stub é instantâneo e o real
  // (US3) usa MSW, então não atrasa a suíte significativamente.
  const postConnect = runPostConnectSetup(
    supabase,
    input.tenantId,
    input.credentials.access_token,
  ).catch((err: unknown) => {
    logger.error(
      { err, tenant_id: input.tenantId },
      'post-connect-setup-fire-and-forget-failed',
    )
    void recordSyncFailure(supabase, input.tenantId, {
      kind: 'connect',
      errorCode: 'POST_CONNECT_FAILED',
      errorMessage: err instanceof Error ? err.message : String(err),
    }).catch(() => {})
  })
  if (process.env.NODE_ENV === 'test') {
    await postConnect
  }

  return {
    tenantId: input.tenantId,
    warnings: [],
  }
}

async function ensureTenantRow(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  location: { id: string; name: string; timezone: string | null },
): Promise<void> {
  // Confere se o tenant já existe (idempotente em retries de install).
  const { data: existing } = await supabase
    .from('tenants')
    .select('id')
    .eq('id', tenantId)
    .maybeSingle()
  if (existing) return

  const slug = makeSlugFromName(location.name)
  const { error } = await supabase.from('tenants').insert({
    id: tenantId,
    name: location.name,
    slug,
    timezone: location.timezone ?? 'America/Sao_Paulo',
  })
  if (error) {
    throw new Error(`ensureTenantRow insert failed: ${error.message}`)
  }
}

async function tenantRowExists(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('tenants')
    .select('id')
    .eq('id', tenantId)
    .maybeSingle()
  return data !== null
}

async function recordRejectionAudit(
  supabase: SupabaseClient<Database>,
  input: ConnectGhlTenantInput,
  code: typeof GHL_TENANT_ALREADY_CONNECTED | typeof GHL_LOCATION_ALREADY_BOUND | string,
): Promise<void> {
  const fieldSuffix = code.toLowerCase()
  const newValue = {
    location_id: input.location.id,
    source: input.source,
  }
  // Audit em audit_log via insert direto — recordSimpleIntegrationEvent
  // exige tenant_id NOT NULL e algumas rejeições (install para tenant não
  // criado ainda) não têm tenant. Mantemos shape consistente para
  // observabilidade.
  const { error } = await supabase.from('audit_log').insert({
    tenant_id: input.tenantId,
    actor_id: input.actorUserId,
    actor_label: input.actorLabel,
    entity: 'tenant_integrations',
    entity_id: input.tenantId,
    field: `connect.rejected:${fieldSuffix}`,
    old_value: null,
    new_value: JSON.stringify(newValue),
    reason:
      code === GHL_TENANT_ALREADY_CONNECTED
        ? 'GHL connect rejected — tenant already has active integration'
        : 'GHL connect rejected — location already bound to another tenant',
    ip: input.ip ?? null,
    user_agent: input.userAgent ?? null,
    result: 'conflict',
  })
  if (error) {
    throw new Error(`recordRejectionAudit insert failed: ${error.message}`)
  }
}

function makeSlugFromName(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  if (base.length === 0) return `tenant-${Date.now()}`
  return `${base}-${Math.random().toString(36).slice(2, 6)}`
}

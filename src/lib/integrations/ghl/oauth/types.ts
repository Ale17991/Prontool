import { z } from 'zod'

/**
 * Feature 008 — Schemas e tipos do OAuth 2.0 do GHL Marketplace.
 *
 * `GhlOAuthCredentials` substitui o shape antigo (`operations_pat` +
 * `inbound_webhook_secret`) usado pela Feature 002 com o proxy
 * Homio Operations. Tenants legacy mantêm os campos antigos por
 * back-compat até a primeira reconexão (`legacy_*`).
 *
 * `GhlConfigV2` extende a config existente acrescentando `location_id`,
 * mapeamentos OAuth-managed (custom_field_ids, webhook_ids, menu_*) e
 * mantém os campos legados da Feature 002 como opcionais para tenants
 * em estado de migração.
 */

// ---------------------------------------------------------------------------
// Custom fields (slugs internos estáveis — admin nunca vê).
// ---------------------------------------------------------------------------

export const GHL_CUSTOM_FIELD_SLUGS = [
  'cpf',
  'plano_saude',
  'profissional_responsavel',
  'ultimo_atendimento',
  'diagnosticos_ativos',
  'alergias',
] as const

export type GhlCustomFieldSlug = (typeof GHL_CUSTOM_FIELD_SLUGS)[number]

/** Tipos GHL v2 — `LARGE_TEXT` para multilinha; o spec usa "TEXT_LONG" mas a API real chama LARGE_TEXT. */
export type GhlCustomFieldDataType = 'TEXT' | 'LARGE_TEXT' | 'DATE' | 'NUMBER' | 'PHONE'

export const GHL_CUSTOM_FIELD_DEFINITIONS: Record<
  GhlCustomFieldSlug,
  { name: string; alias: string; dataType: GhlCustomFieldDataType }
> = {
  cpf: { name: 'CPF', alias: 'clinni_cpf', dataType: 'TEXT' },
  plano_saude: { name: 'Plano de Saúde', alias: 'clinni_plano_saude', dataType: 'TEXT' },
  profissional_responsavel: {
    name: 'Profissional Responsável',
    alias: 'clinni_profissional',
    dataType: 'TEXT',
  },
  ultimo_atendimento: {
    name: 'Último Atendimento',
    alias: 'clinni_ultimo_atendimento',
    dataType: 'DATE',
  },
  diagnosticos_ativos: {
    name: 'Diagnósticos Ativos',
    alias: 'clinni_diagnosticos_ativos',
    dataType: 'LARGE_TEXT',
  },
  alergias: { name: 'Alergias', alias: 'clinni_alergias', dataType: 'TEXT' },
}

// ---------------------------------------------------------------------------
// Webhook events registrados na sub-account.
// ---------------------------------------------------------------------------

export const GHL_WEBHOOK_EVENTS = [
  'ContactCreate',
  'ContactUpdate',
  'OpportunityStatusUpdate',
] as const

export type GhlWebhookEvent = (typeof GHL_WEBHOOK_EVENTS)[number]

// ---------------------------------------------------------------------------
// OAuth credentials shape (cifrado em tenant_integrations.credentials_enc).
// ---------------------------------------------------------------------------

export const ghlOAuthCredentialsSchema = z.object({
  access_token: z.string().min(20, 'access_token muito curto'),
  refresh_token: z.string().min(20, 'refresh_token muito curto'),
  expires_at: z.string().datetime({ message: 'expires_at deve ser ISO 8601 UTC' }),
  scopes: z.array(z.string().min(1)).min(1),
  user_type: z.enum(['Location', 'Company']),
  location_id: z.string().min(1),
  company_id: z.string().min(1),
  user_id: z.string().min(1),

  // Back-compat — preservado em tenants Feature 002 não-migrados.
  // Removido na primeira reconexão OAuth.
  legacy_operations_pat: z.string().optional(),
  legacy_inbound_webhook_secret: z.string().optional(),
})

export type GhlOAuthCredentials = z.infer<typeof ghlOAuthCredentialsSchema>

// ---------------------------------------------------------------------------
// GhlConfigV2 — payload público de tenant_integrations.config.
// ---------------------------------------------------------------------------

const customFieldIdEntrySchema = z.object({
  id: z.string().min(1),
  alias: z.string().min(1),
})

export const ghlConfigV2Schema = z.object({
  location_id: z.string().min(1),
  sub_account_name: z.string().min(1),
  timezone: z.string().nullable().default(null),

  // Mapa parcial até post-connect-setup popular todos.
  custom_field_ids: z
    .object({
      cpf: customFieldIdEntrySchema.optional(),
      plano_saude: customFieldIdEntrySchema.optional(),
      profissional_responsavel: customFieldIdEntrySchema.optional(),
      ultimo_atendimento: customFieldIdEntrySchema.optional(),
      diagnosticos_ativos: customFieldIdEntrySchema.optional(),
      alergias: customFieldIdEntrySchema.optional(),
    })
    .default({}),

  webhook_ids: z
    .object({
      ContactCreate: z.string().optional(),
      ContactUpdate: z.string().optional(),
      OpportunityStatusUpdate: z.string().optional(),
    })
    .default({}),

  menu_id: z.string().nullable().default(null),
  menu_status: z
    .enum(['registered', 'unsupported', 'failed', 'not_attempted'])
    .default('not_attempted'),

  // Back-compat com Feature 002 — adapter v2 ignora; mantemos para que
  // configurações legadas não sejam apagadas no primeiro upsert OAuth.
  trigger_stage_name: z.string().optional(),
  field_map_plano: z.string().optional(),
  field_map_procedimento_tuss: z.string().optional(),
  field_map_profissional: z.string().optional(),
  field_map_valor: z.string().optional(),

  // Toggle opcional do auto-provisioning de usuário no fluxo SSO (US5).
  sso_auto_provisioning: z.boolean().default(false),
})

export type GhlConfigV2 = z.infer<typeof ghlConfigV2Schema>

// ---------------------------------------------------------------------------
// Marketplace webhooks (INSTALL / UNINSTALL).
// ---------------------------------------------------------------------------

export const marketplaceTokensSchema = z.object({
  access_token: z.string().min(20),
  refresh_token: z.string().min(20),
  expires_in: z.number().int().positive(),
  scope: z.string().min(1),
})

export const marketplaceLocationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  timezone: z.string().nullable().optional(),
  countryCode: z.string().nullable().optional(),
})

export const marketplaceUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().email().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  type: z.enum(['Location', 'Company']).optional(),
})

export const marketplaceInstallSchema = z.object({
  eventId: z.string().min(1),
  type: z.literal('INSTALL'),
  appId: z.string().min(1),
  companyId: z.string().min(1),
  locationId: z.string().min(1),
  location: marketplaceLocationSchema,
  user: marketplaceUserSchema.optional(),
  tokens: marketplaceTokensSchema,
  installedAt: z.string().datetime(),
})

export type MarketplaceInstallPayload = z.infer<typeof marketplaceInstallSchema>

export const marketplaceUninstallSchema = z.object({
  eventId: z.string().min(1),
  type: z.literal('UNINSTALL'),
  appId: z.string().min(1),
  companyId: z.string().min(1),
  locationId: z.string().min(1),
  uninstalledAt: z.string().datetime(),
  reason: z.string().optional(),
})

export type MarketplaceUninstallPayload = z.infer<typeof marketplaceUninstallSchema>

// ---------------------------------------------------------------------------
// Endpoint constants (services.leadconnectorhq.com v2).
// ---------------------------------------------------------------------------

export const GHL_API_BASE = 'https://services.leadconnectorhq.com'
export const GHL_OAUTH_TOKEN_URL = `${GHL_API_BASE}/oauth/token`
export const GHL_OAUTH_CHOOSE_LOCATION_URL =
  'https://marketplace.gohighlevel.com/oauth/chooselocation'
export const GHL_API_VERSION = '2021-07-28'

// Janela de segurança antes de `expires_at` para acionar refresh proativo.
export const GHL_TOKEN_REFRESH_LEEWAY_MS = 60_000

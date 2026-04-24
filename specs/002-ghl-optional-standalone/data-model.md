# Phase 1 — Data Model

**Feature**: GHL Opcional + Modo Standalone + Multi-Plataforma  
**Date**: 2026-04-24

Principais mudanças estruturais:

1. **Nova tabela `tenant_integrations`** (substitui `tenant_ghl_config`, com migração de dados).
2. **Adapter interface** tipada em `src/lib/integrations/types.ts` — contrato que todo provider cumpre.
3. **Uso de `audit_log` e `alerts` existentes** para eventos provider-agnósticos (com `provider` no payload).

---

## Entity: `tenant_integrations` (NEW)

Fonte única de verdade para "qual tenant tem quais integrações ativas".

### Fields

| Field | Type | Null | Notes |
|-------|------|------|-------|
| `tenant_id` | `UUID` | NOT NULL | FK → `tenants.id` ON DELETE CASCADE |
| `provider` | `TEXT` | NOT NULL | `'ghl' \| 'hubspot' \| 'rdstation' \| 'pipedrive' \| 'generic_webhook'`; check constraint contra `registry` atual |
| `config` | `JSONB` | NOT NULL | Shape validado por `registry[provider].configSchema` — campos públicos (location_id, portal_id, field_maps, trigger stage, URLs) |
| `credentials_enc` | `BYTEA` | NOT NULL | JSON cifrado via `enc_text_with_key(..., PATIENT_DATA_ENCRYPTION_KEY)`. Shape validado por `registry[provider].credentialsSchema` |
| `webhook_secret_enc` | `BYTEA` | NULL | Separado de `credentials` porque o secret de assinatura inbound costuma ser diferente do PAT de outbound; nullable para providers sem inbound (ex.: `generic_webhook` puro outbound) |
| `enabled` | `BOOLEAN` | NOT NULL | DEFAULT TRUE; permite pause sem perder config |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | DEFAULT now() |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | trigger `touch_updated_at` |
| `created_by_user_id` | `UUID` | NOT NULL | FK → `auth.users(id)` — audit |

**Primary key**: composite `(tenant_id, provider)`. Garantia: 1 linha por tenant × provider.

### Migration

`supabase/migrations/0040_tenant_integrations.sql`:

```sql
CREATE TABLE IF NOT EXISTS public.tenant_integrations (
  tenant_id           UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider            TEXT NOT NULL
                      CHECK (provider IN ('ghl','hubspot','rdstation','pipedrive','generic_webhook')),
  config              JSONB NOT NULL,
  credentials_enc     BYTEA NOT NULL,
  webhook_secret_enc  BYTEA,
  enabled             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id  UUID NOT NULL REFERENCES auth.users(id),
  PRIMARY KEY (tenant_id, provider)
);

CREATE INDEX IF NOT EXISTS tenant_integrations_by_tenant_enabled
  ON public.tenant_integrations (tenant_id) WHERE enabled;

DROP TRIGGER IF EXISTS tenant_integrations_touch_updated_at ON public.tenant_integrations;
CREATE TRIGGER tenant_integrations_touch_updated_at
  BEFORE UPDATE ON public.tenant_integrations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- RLS
ALTER TABLE public.tenant_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_integrations_tenant_read ON public.tenant_integrations
  FOR SELECT USING (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_integrations_admin_write ON public.tenant_integrations
  FOR ALL
  USING  (tenant_id = public.current_tenant_id() AND public.current_user_role() = 'admin')
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.current_user_role() = 'admin');

-- Data migration from tenant_ghl_config → tenant_integrations (provider='ghl')
INSERT INTO public.tenant_integrations
       (tenant_id, provider, config, credentials_enc, webhook_secret_enc,
        enabled, created_by_user_id)
SELECT tgc.tenant_id,
       'ghl',
       jsonb_build_object(
         'location_id',                  COALESCE(tgc.location_id, 'BACKFILL_VIA_UI'),
         'trigger_stage_name',           tgc.trigger_stage_name,
         'field_map_plano',              tgc.field_map_plano,
         'field_map_procedimento_tuss', tgc.field_map_procedimento_tuss,
         'field_map_profissional',       tgc.field_map_profissional,
         'field_map_valor',              tgc.field_map_valor
       ),
       COALESCE(tgc.operations_pat_enc, '\x'::bytea),     -- PAT opcional; se nulo grava vazio e adapter pula
       tgc.webhook_secret_enc,
       TRUE,
       (SELECT id FROM auth.users ORDER BY created_at ASC LIMIT 1) -- placeholder para rows legadas
  FROM public.tenant_ghl_config tgc
  ON CONFLICT (tenant_id, provider) DO NOTHING;
```

`supabase/migrations/0041_drop_tenant_ghl_config.sql` (rodar **depois** do deploy do 0040 + atualização de todos os call sites):

```sql
DROP TABLE IF EXISTS public.tenant_ghl_config;
```

### Validation rules (app-layer)

Schema dinâmico: ao receber `POST /api/configuracoes/integracoes/[provider]`, o handler resolve `registry[provider]` e valida `body.config` contra `configSchema` + `body.credentials` contra `credentialsSchema`.

Exemplos por provider:

```ts
// ghl
configSchema = z.object({
  location_id: z.string().regex(/^[A-Za-z0-9]{20,40}$/),
  trigger_stage_name: z.string().min(1).max(100),
  field_map_plano: z.string().min(1).max(60),
  field_map_procedimento_tuss: z.string().min(1).max(60),
  field_map_profissional: z.string().min(1).max(60),
  field_map_valor: z.string().min(1).max(60),
});
credentialsSchema = z.object({
  operations_pat: z.string().min(10).max(200),         // PAT no proxy
  inbound_webhook_secret: z.string().min(32).max(128), // segredo HMAC do webhook inbound
});

// generic_webhook
configSchema = z.object({
  outbound_url: z.string().url(),
  events: z.array(z.enum(['patient.created','appointment.created','appointment.reversed'])).min(1),
});
credentialsSchema = z.object({
  bearer_token: z.string().min(8).max(256).optional(),
});
```

---

## Entity: `tenants` (existing — unchanged)

Nenhuma mudança de schema. Modo do tenant = `getEnabledIntegrations(tenantId).length > 0 ? 'connected' : 'standalone'`.

---

## Entity: `patients` (existing — unchanged)

`ghl_contact_id` continua presente e `NULL`able. **Nota**: como temos múltiplos providers, a ligação "paciente ↔ registro no provider" fica em coluna dedicada só para GHL hoje. Se outros providers precisarem guardar um ID externo, criamos nova tabela `patient_integration_refs (patient_id, provider, external_id)` num feature futuro — fora do escopo desta feature. Por enquanto:

- **Decisão**: manter `patients.ghl_contact_id` como está (usada apenas pelo adapter GHL). Outros adapters tipicamente não precisam guardar ID do contato (eles pesquisam por email/CPF). Se virar necessidade, abre-se a tabela de refs.

Nenhuma alteração de schema.

---

## Entity: `appointments` (existing — unchanged)

Coluna `source TEXT CHECK (source IN ('ghl','manual'))` já existe. Fluxo manual escreve `'manual'`. Fluxo webhook de outros providers (HubSpot etc.) não está em escopo para P4 inicial — se for adicionado, estendemos o CHECK ou substituímos por TEXT livre + índice.

Nenhuma alteração de schema para esta feature.

### State transitions

Imutável (Principle I). Estorno cria novo registro. Aplicável a todas as origens de forma idêntica (FR-006).

---

## Entity: `audit_log` (existing — novos event types, provider-agnósticos)

| `event_type` | Trigger | Actor | `before_value` | `after_value` | `entity_id` |
|--------------|---------|-------|----------------|---------------|-------------|
| `integration.connect` | `POST /api/configuracoes/integracoes/[provider]` e ausência prévia | admin | `null` | `{provider, config, credentials:redacted}` | `"<tenant_id>:<provider>"` |
| `integration.reconfigure` | `POST` com linha existente | admin | redacted anterior | redacted nova | `"<tenant_id>:<provider>"` |
| `integration.disconnect` | `DELETE /api/configuracoes/integracoes/[provider]` | admin | redacted anterior | `null` | `"<tenant_id>:<provider>"` |
| `appointment.price_override` | `createAppointmentManually` com `amount_cents_override` | admin/recepcionista | `{amount_cents: vigente}` | `{amount_cents: override}` | `appointment_id` |

Redaction:
- Chamador (`src/lib/core/audit/integration-events.ts`) invoca `adapter.redactCredentials(credentials)` para obter versão segura antes de gravar. Nunca grava `credentials_enc` bruto ou decifrado.

---

## Entity: `alerts` (existing — `ghl_sync_failed` renomeado para `integration_sync_failed`)

### Migration

`supabase/migrations/0042_rename_alert_type.sql`:

```sql
UPDATE public.alerts SET type = 'integration_sync_failed' WHERE type = 'ghl_sync_failed';
-- Atualizar CHECK constraint, se houver:
ALTER TABLE public.alerts DROP CONSTRAINT IF EXISTS alerts_type_check;
ALTER TABLE public.alerts ADD CONSTRAINT alerts_type_check
  CHECK (type IN ('integration_sync_failed' /*, outros tipos existentes */));
```

### Shape

`detail` JSONB ganha `provider`:

```json
{
  "provider": "ghl",
  "action": "create_contact",
  "failure_reason": "connection timeout"
}
```

`subjectRef` continua: `{ patient_id? }` ou `{ appointment_id? }`.

---

## Non-entity: `IntegrationAdapter` (TypeScript contract)

Não é tabela; é o **contrato** que todo provider cumpre em `src/lib/integrations/<provider>/adapter.ts`.

```ts
// src/lib/integrations/types.ts
import type { z } from 'zod';
import type { Logger } from 'pino';

export type ProviderId = 'ghl' | 'hubspot' | 'rdstation' | 'pipedrive' | 'generic_webhook';

export interface PatientSnapshot {
  id: string;
  tenantId: string;
  fullName: string;
  cpf: string;
  email: string | null;
  phone: string | null;
  birthDate: string | null;
  planId: string | null;
  ghlContactId: string | null;
}

export interface AppointmentSnapshot {
  id: string;
  tenantId: string;
  patientId: string;
  doctorId: string;
  procedureId: string;
  procedureTussCode: string;
  planId: string;
  appointmentAt: string;       // ISO UTC
  frozenAmountCents: number;
  source: 'ghl' | 'manual';
}

export type DomainEvent =
  | { type: 'patient.created';     patient: PatientSnapshot }
  | { type: 'appointment.created'; appointment: AppointmentSnapshot; patient: PatientSnapshot }
  | { type: 'appointment.reversed'; original: AppointmentSnapshot; reversal: AppointmentSnapshot; reason: string };

export interface AdapterContext<Config = unknown, Credentials = unknown> {
  tenantId: string;
  provider: ProviderId;
  config: Config;
  credentials: Credentials;
  logger: Logger;
  now: () => Date;
}

export interface IntegrationAdapter<Config = unknown, Credentials = unknown> {
  provider: ProviderId;
  label: string;
  description: string;
  configSchema: z.ZodSchema<Config>;
  credentialsSchema: z.ZodSchema<Credentials>;
  redactCredentials(c: Credentials): Record<string, string>;
  extractTenantIdFromWebhook?(req: Request): Promise<string | null>;
  handleInboundWebhook?(
    ctx: AdapterContext<Config, Credentials>,
    req: Request,
  ): Promise<Response>;
  handleDomainEvent(
    ctx: AdapterContext<Config, Credentials>,
    event: DomainEvent,
  ): Promise<void>;
}
```

Registry central:

```ts
// src/lib/integrations/registry.ts
import type { IntegrationAdapter, ProviderId } from './types';
import { ghlAdapter } from './ghl/adapter';
import { genericWebhookAdapter } from './generic-webhook/adapter';

export const registry: Record<ProviderId, IntegrationAdapter<any, any>> = {
  ghl: ghlAdapter,
  generic_webhook: genericWebhookAdapter,
  // hubspot: hubspotAdapter,    // P4+
  // rdstation: rdstationAdapter,
  // pipedrive: pipedriveAdapter,
};

export function getAdapter(provider: string): IntegrationAdapter | null {
  return (registry as Record<string, IntegrationAdapter>)[provider] ?? null;
}

export function listProviders(): ProviderId[] {
  return Object.keys(registry) as ProviderId[];
}
```

---

## Relationships summary

```text
┌─────────────┐                ┌────────────────────────┐
│ tenants     │───1:N─────────▶│ tenant_integrations    │
└─────────────┘                │ (tenant_id, provider)  │
       │                       │ config, credentials    │
       │                       └────────────────────────┘
       │                                   │
       │                                   │ consumed by
       │                                   ▼
       │                       ┌────────────────────────┐
       │                       │ registry (in-code)     │
       │                       │ ghl, generic_webhook,  │
       │                       │ hubspot*, rdstation*…  │
       │                       └────────────────────────┘
       │
       │      ┌────────────────┐
       ├─1:N─▶│ patients       │  (unchanged)
       │      └────────────────┘
       │      ┌────────────────┐
       ├─1:N─▶│ appointments   │  (unchanged)
       │      └────────────────┘
       │      ┌────────────────┐
       ├─1:N─▶│ audit_log      │  (novos event_type: integration.*)
       │      └────────────────┘
       │      ┌────────────────┐
       └─1:N─▶│ alerts         │  (type: integration_sync_failed)
              └────────────────┘

Event flow (P3+):
  create-manual.ts  ──publish──▶  events/publish.ts  ──▶  events/dispatch.ts
                                                            │
                                         ┌──fan-out (Promise.allSettled)──┐
                                         ▼                 ▼              ▼
                                    ghlAdapter    genericWebhookAdapter   …
                                    (HTTP POST     (HTTP POST to            
                                     proxy)         configured URL)         
```

---

## Derived concept: "tenant mode"

```ts
type TenantMode = 'standalone' | 'connected';

async function getTenantMode(supabase, tenantId): Promise<TenantMode> {
  const enabled = await getEnabledIntegrations(supabase, tenantId);
  return enabled.length > 0 ? 'connected' : 'standalone';
}

async function getEnabledIntegrations(supabase, tenantId) {
  const { data } = await supabase
    .from('tenant_integrations')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('enabled', true);
  return data ?? [];
}
```

Usado em: layout do dashboard (badges de sidebar), dispatcher de eventos, rotas de webhook inbound.

# Phase 1 — Data Model: Integração GHL Marketplace (OAuth 2.0)

**Feature**: `008-ghl-marketplace-oauth`
**Migration**: `supabase/migrations/0062_ghl_oauth_marketplace.sql`

## Schema delta — `tenant_integrations`

A tabela já existe (criada em `0040_tenant_integrations.sql`). A feature **acrescenta** três colunas e **um índice unique parcial**, sem alterar PK nem RLS existentes.

```sql
-- 0062 — Feature 008: OAuth 2.0 com GHL Marketplace.
-- Acrescenta colunas de status/timestamp/location_id em tenant_integrations,
-- cria integration_sync_log (append-only, retenção curta), e ajusta políticas
-- onde necessário. Não altera nem apaga linhas existentes.

ALTER TABLE public.tenant_integrations
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected','disconnected','token_expired'));

ALTER TABLE public.tenant_integrations
  ADD COLUMN IF NOT EXISTS connected_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- location_id é uma view computada do JSON config — fica em coluna gerada
-- para ser indexável e para permitir UNIQUE entre tenants.
ALTER TABLE public.tenant_integrations
  ADD COLUMN IF NOT EXISTS location_id TEXT
    GENERATED ALWAYS AS ((config->>'location_id')) STORED;

-- Uma sub-account GHL não pode estar mapeada a dois tenants Prontool ativos
-- simultaneamente (FR-026). NULL é permitido (provider != 'ghl').
CREATE UNIQUE INDEX IF NOT EXISTS tenant_integrations_unique_active_location_id
  ON public.tenant_integrations (location_id)
  WHERE provider = 'ghl' AND enabled = true AND location_id IS NOT NULL;
```

### Invariantes derivados

- `enabled = true AND status = 'connected'` ⇒ caminho ativo de sync (outbound + inbound).
- `enabled = true AND status = 'token_expired'` ⇒ inbound continua válido (assinatura via `webhook_secret_enc` ainda configurada), outbound degrada graciosamente, UI mostra "Reconectar".
- `enabled = false AND status = 'disconnected'` ⇒ desconectado (manual ou via `UNINSTALL`); dados clínicos preservados; webhooks GHL removidos via API.
- Transições válidas:
  - `(*)` → `connected` via `connect-tenant.ts`.
  - `connected` → `token_expired` via falha de refresh.
  - `connected | token_expired` → `disconnected` via `disconnect-tenant.ts`.
  - **NÃO** existe `disconnected` → `connected` direto sem passar por `connect-tenant.ts` (que vem de OAuth callback ou marketplace install).

## Schema novo — `integration_sync_log`

Tabela append-only que alimenta o componente "últimas 10 operações" da UI sem precisar varrer `audit_log` (que tem retenção mais longa e tipos de evento mais largos).

```sql
CREATE TABLE IF NOT EXISTS public.integration_sync_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind         TEXT NOT NULL CHECK (kind IN (
                 'outbound_contact',
                 'outbound_note',
                 'outbound_update',
                 'inbound_contact',
                 'token_refresh',
                 'custom_field_setup',
                 'webhook_setup',
                 'custom_menu_setup',
                 'connect',
                 'disconnect'
               )),
  status       TEXT NOT NULL CHECK (status IN ('success','failure')),
  error_code   TEXT,
  error_message TEXT,
  detail       JSONB
);

CREATE INDEX IF NOT EXISTS integration_sync_log_tenant_recent
  ON public.integration_sync_log (tenant_id, provider, occurred_at DESC);

ALTER TABLE public.integration_sync_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS integration_sync_log_tenant_read ON public.integration_sync_log;
CREATE POLICY integration_sync_log_tenant_read
  ON public.integration_sync_log
  FOR SELECT
  USING (tenant_id = public.jwt_tenant_id());

-- Inserts são feitos com service-role client (a partir do core); RLS recusa
-- inserts feitos pelo JWT do usuário diretamente.
DROP POLICY IF EXISTS integration_sync_log_no_user_write ON public.integration_sync_log;
CREATE POLICY integration_sync_log_no_user_write
  ON public.integration_sync_log
  FOR INSERT
  WITH CHECK (false);

-- Imutabilidade (Principle I).
CREATE OR REPLACE FUNCTION public.integration_sync_log_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'integration_sync_log is append-only';
END $$;

DROP TRIGGER IF EXISTS integration_sync_log_no_update ON public.integration_sync_log;
CREATE TRIGGER integration_sync_log_no_update
  BEFORE UPDATE OR DELETE ON public.integration_sync_log
  FOR EACH ROW EXECUTE FUNCTION public.integration_sync_log_immutable();

-- Retenção: manter ~ 100 entradas mais recentes por (tenant, provider) para
-- evitar inflar a tabela. UI consome só as 10 últimas; 100 cobre debug.
CREATE OR REPLACE FUNCTION public.integration_sync_log_trim()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  cutoff_id UUID;
BEGIN
  SELECT id INTO cutoff_id
    FROM public.integration_sync_log
   WHERE tenant_id = NEW.tenant_id AND provider = NEW.provider
   ORDER BY occurred_at DESC
   OFFSET 100 LIMIT 1;

  IF cutoff_id IS NOT NULL THEN
    DELETE FROM public.integration_sync_log
     WHERE tenant_id = NEW.tenant_id
       AND provider = NEW.provider
       AND occurred_at <= (SELECT occurred_at FROM public.integration_sync_log WHERE id = cutoff_id);
  END IF;
  RETURN NULL;
END $$;

-- Trigger desabilitado pelo trigger _no_update acima durante DELETE? Não:
-- _no_update dispara em DELETE de QUALQUER linha. Para retenção, usamos um
-- truncate-like via service_role helper chamado pelo core periodicamente,
-- ou um trigger AFTER INSERT que executa com SECURITY DEFINER e bypassa
-- RLS — mas DELETE ainda é proibido. Solução: o trigger _immutable não
-- intercepta TRUNCATE em SECURITY DEFINER se chamado por owner; alternativa
-- mais simples e segura é DEIXAR a tabela crescer e ter um job periódico
-- separado fazendo DELETE com a flag de "trim allowed" via TRUNCATE PARTITION
-- futura. Para v1 assumimos crescimento limitado (poucos tenants × 10 ops/dia).

-- DECISÃO v1: NÃO instalar trigger de retenção; a tabela cresce limitadamente.
-- Quando virar problema, particionamos por mês ou adicionamos job dedicado.
```

> **Nota** sobre a função `integration_sync_log_trim`: deixei o esboço acima documentando o desejo de retenção, mas a versão final da migration **não** instala o trigger AFTER INSERT — ele entra em conflito com `_no_update` (DELETE proibido), e o ganho não justifica complicar a história append-only. Em v1 a tabela cresce livremente; com a estimativa de uso (dezenas de tenants × ~10 ops/dia) isso fica abaixo de 1M linhas em um ano. Particionamento entra como follow-up se necessário.

## TypeScript — formatos de credentials e config v2

Local: `src/lib/integrations/ghl/oauth/types.ts` (parte do design; código real é a Phase 2).

```ts
export const ghlOAuthCredentialsSchema = z.object({
  access_token: z.string().min(20),
  refresh_token: z.string().min(20),
  expires_at: z.string().datetime(), // ISO UTC
  scopes: z.array(z.string().min(1)).min(1),
  user_type: z.enum(['Location', 'Company']),
  location_id: z.string().min(1),
  company_id: z.string().min(1),
  user_id: z.string().min(1),
  // Mantido APENAS durante migração. Removido na primeira reconexão.
  legacy_operations_pat: z.string().optional(),
  legacy_inbound_webhook_secret: z.string().optional(),
})
export type GhlOAuthCredentials = z.infer<typeof ghlOAuthCredentialsSchema>

export const ghlConfigV2Schema = z.object({
  location_id: z.string().min(1),
  sub_account_name: z.string().min(1),
  timezone: z.string().nullable(),
  custom_field_ids: z
    .object({
      cpf: z.object({ id: z.string(), alias: z.string() }),
      plano_saude: z.object({ id: z.string(), alias: z.string() }),
      profissional_responsavel: z.object({ id: z.string(), alias: z.string() }),
      ultimo_atendimento: z.object({ id: z.string(), alias: z.string() }),
      diagnosticos_ativos: z.object({ id: z.string(), alias: z.string() }),
      alergias: z.object({ id: z.string(), alias: z.string() }),
    })
    .partial(), // partial até o setup pós-conexão concluir
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

  // Back-compat com Feature 002 — pode ser ignorado pelo adapter v2.
  trigger_stage_name: z.string().optional(),
  field_map_plano: z.string().optional(),
  field_map_procedimento_tuss: z.string().optional(),
  field_map_profissional: z.string().optional(),
  field_map_valor: z.string().optional(),
})
export type GhlConfigV2 = z.infer<typeof ghlConfigV2Schema>
```

### Custom field mapping (referência única)

| Slug interno               | Nome visível (GHL)       | Tipo (GHL v2) |
| -------------------------- | ------------------------ | ------------- |
| `cpf`                      | CPF                      | `TEXT`        |
| `plano_saude`              | Plano de Saúde           | `TEXT`        |
| `profissional_responsavel` | Profissional Responsável | `TEXT`        |
| `ultimo_atendimento`       | Último Atendimento       | `DATE`        |
| `diagnosticos_ativos`      | Diagnósticos Ativos      | `LARGE_TEXT`  |
| `alergias`                 | Alergias                 | `TEXT`        |

Em colisão por nome E tipo divergente, o sistema cria `"<Nome visível> (Prontool)"` (Q2: C). O **slug interno** é a chave estável — admin nunca vê.

## audit_log — novos `event_type`

Reusa a tabela existente. Esta feature acrescenta os seguintes valores em `event_type` (apenas convenção; a coluna é livre `TEXT`):

| event_type                      | Quando                                                | actor                                                         | valor_anterior / valor_novo                |
| ------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------ |
| `integration.connect`           | Após `connect-tenant.ts` ter persistido tokens novos. | usuário admin (manual) ou `system:ghl_marketplace` (install). | `status: null/disconnected` → `connected`  |
| `integration.reconfigure`       | Quando admin atualiza config sem refazer OAuth.       | admin.                                                        | diff em JSON.                              |
| `integration.disconnect`        | Após `disconnect-tenant.ts`.                          | admin (manual) ou `system:ghl_marketplace` (uninstall).       | `connected/token_expired` → `disconnected` |
| `integration.refresh_success`   | Após refresh bem-sucedido.                            | `system:ghl_oauth_refresh`.                                   | `expires_at: <antigo>` → `<novo>`          |
| `integration.refresh_failed`    | Após refresh definitivo (sem retry).                  | `system:ghl_oauth_refresh`.                                   | `status: connected` → `token_expired`      |
| `integration.signature_failure` | Webhook chegou com assinatura inválida.               | `system:webhook` (sem tenant).                                | n/a                                        |

Todos com `tenant_id`, `entidade='tenant_integrations'`, `motivo` textual, `origem_da_requisição` (IP/UA quando manual; `marketplace_install` quando automatizado).

## alerts — novos `type` (uso, sem schema change)

Reusa `alert_type` existente da tabela `alerts`. Esta feature emite:

| type                            | detail.\* mínimo                                                                 | Quando                                          |
| ------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------- |
| `integration_sync_failed`       | `provider='ghl'`, `kind`, `error_code`, `tenant_id`, `correlation_id`            | Outbound falhou após retries OU refresh falhou. |
| `signature_failure` (existente) | `provider='ghl'`, `kind='marketplace_install'\|'marketplace_uninstall'\|'event'` | Webhook GHL com assinatura inválida.            |

## Variáveis de ambiente (lidas só em `oauth/env.ts`)

| Var                             | Quem lê                                 | Obrigatória                                     |
| ------------------------------- | --------------------------------------- | ----------------------------------------------- |
| `GHL_CLIENT_ID`                 | `oauth/env.ts`                          | Sim                                             |
| `GHL_CLIENT_SECRET`             | `oauth/env.ts`                          | Sim                                             |
| `GHL_REDIRECT_URI`              | `oauth/env.ts`                          | Sim                                             |
| `GHL_SCOPES`                    | `oauth/env.ts`                          | Sim                                             |
| `GHL_MARKETPLACE_SHARED_SECRET` | `oauth/verify-marketplace-signature.ts` | Sim                                             |
| `GHL_SSO_JWKS_URL`              | `oauth/verify-sso-token.ts`             | Sim para US5; opcional caso US5 saia da feature |
| `PATIENT_DATA_ENCRYPTION_KEY`   | core (já existente)                     | Sim                                             |

`pnpm lint:auth` precisa permitir essas leituras **apenas** dentro de `src/lib/integrations/ghl/oauth/**`.

## Fluxos de estado

```text
                 ┌─────────────────┐
                 │ not_connected   │
                 │ (no row)        │
                 └────────┬────────┘
                          │ admin clicks "Conectar"
                          │      OR
                          │ marketplace INSTALL
                          ▼
                 ┌─────────────────┐
                 │   connected     │ ◄────── refresh_success ──── ┐
                 │ enabled=true    │                              │
                 │ status=         │ ──── token_revoked ────┐    │
                 │   'connected'   │                         │    │
                 └────────┬────────┘                         │    │
                          │ admin "Desconectar"               │    │
                          │   OR uninstall                    ▼    │
                          ▼                          ┌──────────────┐
                 ┌─────────────────┐                 │ token_expired│
                 │  disconnected   │                 │ enabled=true │
                 │ enabled=false   │                 │ status=      │
                 │ status=         │                 │ 'token_expired'│
                 │ 'disconnected'  │                 └──────┬───────┘
                 └─────────────────┘                        │
                          ▲                                 │ admin clicks "Reconectar"
                          │                                 │   (new OAuth code)
                          └─────────── after Reconectar ────┘
```

`disconnected` é absorvedor para o lado humano (admin desconectou manualmente). `token_expired` é absorvedor para o lado sistema (refresh falhou). Em ambos os casos, "Reconectar" passa pelo mesmo `connect-tenant.ts`.

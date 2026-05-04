-- 0062 — Feature 008: Integração Prontool x GoHighLevel Marketplace (OAuth 2.0).
--
-- Decisoes:
--   1. ALTER TABLE tenant_integrations: tres colunas novas (status, connected_at,
--      location_id GENERATED). Sem mudanca de PK nem de RLS existente.
--      `status` unifica com `enabled` — caminho ativo de sync requer
--      enabled=true AND status='connected'.
--   2. Indice unique parcial em (location_id) para provider='ghl' AND enabled=true:
--      uma sub-account GHL nao pode estar mapeada a dois tenants Prontool ativos
--      simultaneamente (FR-026). NULL e permitido (provider != 'ghl' ou config
--      sem location_id). Backfill mantem location_id como NULL ate Reconectar.
--   3. integration_sync_log: append-only (Principio I). Trigger BEFORE UPDATE
--      OR DELETE rejeita mutacao. RLS read-only-tenant. INSERT bloqueado para
--      JWT do usuario; service_role bypassa policies (a feature usa service_role
--      client para gravar a partir do core).
--   4. integration_sync_log NAO e financeiro, mas segue o mesmo padrao append-only
--      por consistencia com audit_log e para preservar evidencia de sync.
--   5. Sem trigger de retencao em v1 — tabela cresce limitadamente (dezenas de
--      tenants x ~10 ops/dia = ~100k linhas/ano). Particionamento ou job de
--      cleanup entram como follow-up se necessario.

-- =========================================================================
-- (a) tenant_integrations — colunas novas
-- =========================================================================

ALTER TABLE public.tenant_integrations
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected','disconnected','token_expired'));

ALTER TABLE public.tenant_integrations
  ADD COLUMN IF NOT EXISTS connected_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.tenant_integrations
  ADD COLUMN IF NOT EXISTS location_id TEXT
    GENERATED ALWAYS AS ((config->>'location_id')) STORED;

COMMENT ON COLUMN public.tenant_integrations.status IS
  'connected | disconnected | token_expired. Combinado com enabled determina caminho ativo de sync.';
COMMENT ON COLUMN public.tenant_integrations.connected_at IS
  'Momento da ultima conexao bem-sucedida (manual ou marketplace install).';
COMMENT ON COLUMN public.tenant_integrations.location_id IS
  'Sub-account GHL (extraido de config->>location_id). Coluna gerada para indexacao e UNIQUE cross-tenant.';

CREATE UNIQUE INDEX IF NOT EXISTS tenant_integrations_unique_active_location_id
  ON public.tenant_integrations (location_id)
  WHERE provider = 'ghl' AND enabled = true AND location_id IS NOT NULL;

-- =========================================================================
-- (b) integration_sync_log — append-only com RLS por tenant
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.integration_sync_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind          TEXT NOT NULL CHECK (kind IN (
                  'outbound_contact',
                  'outbound_note',
                  'outbound_update',
                  'inbound_contact',
                  'inbound_opportunity',
                  'token_refresh',
                  'custom_field_setup',
                  'webhook_setup',
                  'custom_menu_setup',
                  'connect',
                  'disconnect'
                )),
  status        TEXT NOT NULL CHECK (status IN ('success','failure')),
  error_code    TEXT,
  error_message TEXT,
  detail        JSONB
);

CREATE INDEX IF NOT EXISTS integration_sync_log_tenant_recent
  ON public.integration_sync_log (tenant_id, provider, occurred_at DESC);

COMMENT ON TABLE public.integration_sync_log IS
  'Trilha append-only de operacoes de sync por integracao. UI consome ultimas 10; tabela retem ate ~100 por (tenant, provider) em v1.';

ALTER TABLE public.integration_sync_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS integration_sync_log_tenant_read ON public.integration_sync_log;
CREATE POLICY integration_sync_log_tenant_read
  ON public.integration_sync_log
  FOR SELECT
  USING (tenant_id = public.jwt_tenant_id());

-- INSERT via JWT do usuario e proibido — gravacao corre com service_role
-- a partir do core (recordSyncSuccess/recordSyncFailure).
DROP POLICY IF EXISTS integration_sync_log_no_user_write ON public.integration_sync_log;
CREATE POLICY integration_sync_log_no_user_write
  ON public.integration_sync_log
  FOR INSERT
  WITH CHECK (false);

-- Imutabilidade (Principio I): UPDATE/DELETE proibidos.
CREATE OR REPLACE FUNCTION public.integration_sync_log_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'integration_sync_log is append-only';
END $$;

DROP TRIGGER IF EXISTS integration_sync_log_no_update ON public.integration_sync_log;
CREATE TRIGGER integration_sync_log_no_update
  BEFORE UPDATE OR DELETE ON public.integration_sync_log
  FOR EACH ROW EXECUTE FUNCTION public.integration_sync_log_immutable();

-- =========================================================================
-- (c) test_truncate_all_mutable — incluir nova tabela na limpeza de testes
-- =========================================================================

CREATE OR REPLACE FUNCTION public.test_truncate_all_mutable(wipe_catalog BOOLEAN DEFAULT FALSE)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  -- Drop e recria triggers que rejeitam DELETE para permitir TRUNCATE.
  -- (TRUNCATE bypassa BEFORE DELETE triggers per-row, mas mantemos seguranca
  -- desabilitando explicitamente em testes.)
  ALTER TABLE public.integration_sync_log DISABLE TRIGGER integration_sync_log_no_update;

  TRUNCATE
    public.integration_sync_log,
    public.audit_log,
    public.alert_status_transitions,
    public.alerts,
    public.webhook_event_transitions,
    public.raw_webhook_events,
    public.appointment_reversals,
    public.appointments,
    public.price_versions,
    public.doctor_commission_history,
    public.doctors,
    public.patients,
    public.procedures,
    public.health_plans,
    public.tenant_integrations,
    public.tenant_ghl_config,
    public.user_tenants,
    public.tenants
  RESTART IDENTITY CASCADE;

  ALTER TABLE public.integration_sync_log ENABLE TRIGGER integration_sync_log_no_update;

  IF wipe_catalog THEN
    TRUNCATE public.tuss_codes, public.tuss_catalog_versions RESTART IDENTITY CASCADE;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.test_truncate_all_mutable(BOOLEAN) TO service_role;

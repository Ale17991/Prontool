-- Feature 002: multi-provider integrations.
-- Replaces tenant_ghl_config (per-tenant, GHL-only) with tenant_integrations
-- (per tenant × provider). Old table is kept in place for now; a follow-up
-- migration drops it after call sites migrate.
--
-- Source of truth for "is this tenant standalone?" becomes:
--   SELECT COUNT(*) FROM tenant_integrations
--    WHERE tenant_id = :t AND enabled
-- Zero rows enabled ⇒ standalone.

CREATE TABLE IF NOT EXISTS public.tenant_integrations (
  tenant_id           UUID    NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider            TEXT    NOT NULL
                      CHECK (provider IN ('ghl', 'hubspot', 'rdstation', 'pipedrive', 'generic_webhook')),
  config              JSONB   NOT NULL,
  credentials_enc     BYTEA   NOT NULL,
  webhook_secret_enc  BYTEA,
  enabled             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id  UUID    NOT NULL REFERENCES auth.users(id),
  PRIMARY KEY (tenant_id, provider)
);

CREATE INDEX IF NOT EXISTS tenant_integrations_enabled_by_tenant
  ON public.tenant_integrations (tenant_id) WHERE enabled;

-- updated_at trigger (reuses the platform helper created in 0002).
DROP TRIGGER IF EXISTS tenant_integrations_touch_updated_at ON public.tenant_integrations;
CREATE TRIGGER tenant_integrations_touch_updated_at
  BEFORE UPDATE ON public.tenant_integrations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Enable RLS.
ALTER TABLE public.tenant_integrations ENABLE ROW LEVEL SECURITY;

-- All reads restricted to the tenant of the JWT. The app layer additionally
-- gates writes to admin via requireRole, but the RLS below makes it
-- impossible for a non-admin JWT to mutate this table even if the app layer
-- is bypassed.
DROP POLICY IF EXISTS tenant_integrations_tenant_read ON public.tenant_integrations;
CREATE POLICY tenant_integrations_tenant_read ON public.tenant_integrations
  FOR SELECT
  USING (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS tenant_integrations_admin_write ON public.tenant_integrations;
CREATE POLICY tenant_integrations_admin_write ON public.tenant_integrations
  FOR ALL
  USING  (tenant_id = public.jwt_tenant_id() AND public.jwt_role() = 'admin')
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() = 'admin');

-- Backfill: any tenant already connected to GHL via tenant_ghl_config gets
-- a mirror row in tenant_integrations(provider='ghl'). The legacy table
-- stays populated until migration 0041 drops it (post-deploy).
--
-- Note: the legacy table did not carry a location_id nor an operations_pat;
-- both are placeholders for now and the admin must reconnect via the UI
-- before outbound sync works. Inbound webhooks continue to work because
-- webhook_secret_enc is copied verbatim.
INSERT INTO public.tenant_integrations
       (tenant_id, provider, config, credentials_enc, webhook_secret_enc,
        enabled, created_by_user_id)
SELECT tgc.tenant_id,
       'ghl',
       jsonb_build_object(
         'location_id',                     'BACKFILL_VIA_UI',
         'trigger_stage_name',              tgc.trigger_stage_name,
         'field_map_plano',                 tgc.field_map_plano,
         'field_map_procedimento_tuss',     tgc.field_map_procedimento_tuss,
         'field_map_profissional',          tgc.field_map_medico_identifier,
         'field_map_valor',                 COALESCE(tgc.field_map_appointment_timestamp, '')
       ),
       '\x'::bytea,                                  -- placeholder; admin must reconnect
       tgc.webhook_secret_enc,
       TRUE,
       (SELECT id FROM auth.users ORDER BY created_at ASC LIMIT 1)
  FROM public.tenant_ghl_config tgc
 WHERE EXISTS (SELECT 1 FROM auth.users)
  ON CONFLICT (tenant_id, provider) DO NOTHING;

-- Extend test_truncate_all_mutable so tests get a clean integrations slate.
CREATE OR REPLACE FUNCTION public.test_truncate_all_mutable(wipe_catalog BOOLEAN DEFAULT FALSE)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  TRUNCATE
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

  IF wipe_catalog THEN
    TRUNCATE public.tuss_codes, public.tuss_catalog_versions RESTART IDENTITY CASCADE;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.test_truncate_all_mutable(BOOLEAN) TO service_role;

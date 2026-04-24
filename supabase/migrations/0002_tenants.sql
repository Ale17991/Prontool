-- T014: Tenants, user↔tenant membership, per-tenant GHL integration config.
-- Constitution Principle III: every downstream tenant-scoped table FKs tenants(id).

CREATE TABLE IF NOT EXISTS public.tenants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  timezone      TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tenants_slug_idx ON public.tenants (slug);

-- N:N between auth.users and tenants with role claim.
CREATE TABLE IF NOT EXISTS public.user_tenants (
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  role        TEXT NOT NULL CHECK (role IN ('admin', 'financeiro', 'recepcionista', 'profissional_saude')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS user_tenants_by_tenant_idx ON public.user_tenants (tenant_id);

-- Per-tenant GHL integration config. webhook_secret is encrypted with
-- the platform-wide PATIENT_DATA_ENCRYPTION_KEY (re-using the same key
-- for simplicity in v1; can be split later).
CREATE TABLE IF NOT EXISTS public.tenant_ghl_config (
  tenant_id                       UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE RESTRICT,
  webhook_secret_enc              BYTEA NOT NULL,
  trigger_stage_name              TEXT NOT NULL,
  field_map_plano                 TEXT NOT NULL,
  field_map_procedimento_tuss     TEXT NOT NULL,
  field_map_medico_identifier     TEXT NOT NULL,
  field_map_patient_name          TEXT NOT NULL,
  field_map_patient_cpf           TEXT NOT NULL,
  field_map_patient_phone         TEXT NOT NULL,
  field_map_patient_email         TEXT NOT NULL,
  field_map_patient_birth_date    TEXT NOT NULL,
  field_map_appointment_timestamp TEXT,
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- updated_at trigger helper, reused by several tables.
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tenants_touch_updated_at ON public.tenants;
CREATE TRIGGER tenants_touch_updated_at
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS tenant_ghl_config_touch_updated_at ON public.tenant_ghl_config;
CREATE TRIGGER tenant_ghl_config_touch_updated_at
  BEFORE UPDATE ON public.tenant_ghl_config
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

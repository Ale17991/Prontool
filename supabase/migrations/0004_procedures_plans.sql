-- T016: Clinic-scoped procedures (subset of TUSS) + health plans.

CREATE TABLE IF NOT EXISTS public.procedures (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  tuss_code     TEXT NOT NULL,
  display_name  TEXT,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID,
  UNIQUE (tenant_id, tuss_code)
);

CREATE INDEX IF NOT EXISTS procedures_tenant_active_idx
  ON public.procedures (tenant_id, active);

CREATE TABLE IF NOT EXISTS public.health_plans (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  name        TEXT NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID,
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS health_plans_tenant_active_idx
  ON public.health_plans (tenant_id, active);

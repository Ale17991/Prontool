-- T018: Append-only chain of price versions per (tenant, procedure, plan).
-- Head of chain = row with greatest valid_from <= today, tiebreaker created_at.
-- FR-004: new version never mutates the prior row; prior vigência is
-- implicitly ended on (next.valid_from - 1 day) via LEAD in the read view.

CREATE TABLE IF NOT EXISTS public.price_versions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  procedure_id          UUID NOT NULL REFERENCES public.procedures(id) ON DELETE RESTRICT,
  plan_id               UUID NOT NULL REFERENCES public.health_plans(id) ON DELETE RESTRICT,
  amount_cents          BIGINT NOT NULL CHECK (amount_cents >= 0),
  valid_from            DATE NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by            UUID NOT NULL,
  reason                TEXT NOT NULL CHECK (char_length(reason) >= 3),
  previous_version_id   UUID REFERENCES public.price_versions(id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, procedure_id, plan_id, valid_from)
);

CREATE INDEX IF NOT EXISTS price_versions_resolve_idx
  ON public.price_versions (tenant_id, procedure_id, plan_id, valid_from DESC, created_at DESC);

-- Read view materializing derived vigência bounds.
CREATE OR REPLACE VIEW public.price_versions_with_vigencia AS
SELECT
  pv.*,
  LEAD(pv.valid_from) OVER (
    PARTITION BY pv.tenant_id, pv.procedure_id, pv.plan_id
    ORDER BY pv.valid_from ASC, pv.created_at ASC
  ) - INTERVAL '1 day' AS valid_to
FROM public.price_versions pv;

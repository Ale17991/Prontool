-- T017: Doctors and append-only commission history.
-- Commission percent stored as basis points (bps): 4000 = 40.00%.

CREATE TABLE IF NOT EXISTS public.doctors (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  full_name             TEXT NOT NULL,
  crm                   TEXT NOT NULL,
  external_identifier   TEXT,                   -- matches GHL custom field
  active                BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by            UUID,
  UNIQUE (tenant_id, crm)
);

CREATE UNIQUE INDEX IF NOT EXISTS doctors_tenant_external_id_idx
  ON public.doctors (tenant_id, external_identifier)
  WHERE external_identifier IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.doctor_commission_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  doctor_id       UUID NOT NULL REFERENCES public.doctors(id) ON DELETE RESTRICT,
  percentage_bps  INTEGER NOT NULL CHECK (percentage_bps BETWEEN 0 AND 10000),
  valid_from      DATE NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID,
  reason          TEXT NOT NULL CHECK (char_length(reason) >= 3),
  UNIQUE (tenant_id, doctor_id, valid_from)
);

CREATE INDEX IF NOT EXISTS doctor_commission_history_active_idx
  ON public.doctor_commission_history (tenant_id, doctor_id, valid_from DESC);

-- View: current commission percentage per doctor (head of chain).
CREATE OR REPLACE VIEW public.doctor_commission_current AS
SELECT DISTINCT ON (tenant_id, doctor_id)
  tenant_id,
  doctor_id,
  percentage_bps,
  valid_from,
  created_at
FROM public.doctor_commission_history
WHERE valid_from <= CURRENT_DATE
ORDER BY tenant_id, doctor_id, valid_from DESC, created_at DESC;

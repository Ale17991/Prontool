-- T020: Appointments (append-only, frozen values), reversals (append-only,
-- compensating records), and the effective-status view.

CREATE TABLE IF NOT EXISTS public.appointments (
  id                                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                         UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  patient_id                        UUID NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  doctor_id                         UUID NOT NULL REFERENCES public.doctors(id) ON DELETE RESTRICT,
  procedure_id                      UUID NOT NULL REFERENCES public.procedures(id) ON DELETE RESTRICT,
  plan_id                           UUID NOT NULL REFERENCES public.health_plans(id) ON DELETE RESTRICT,
  frozen_amount_cents               BIGINT NOT NULL CHECK (frozen_amount_cents >= 0),
  frozen_commission_bps             INTEGER NOT NULL CHECK (frozen_commission_bps BETWEEN 0 AND 10000),
  source_price_version_id           UUID NOT NULL REFERENCES public.price_versions(id) ON DELETE RESTRICT,
  source_commission_history_id      UUID NOT NULL REFERENCES public.doctor_commission_history(id) ON DELETE RESTRICT,
  appointment_at                    TIMESTAMPTZ NOT NULL,
  source                            TEXT NOT NULL DEFAULT 'ghl' CHECK (source IN ('ghl', 'manual')),
  source_raw_event_id               UUID,           -- FK added in 0009 to avoid circular dep
  created_at                        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS appointments_idempotency_idx
  ON public.appointments (tenant_id, source_raw_event_id)
  WHERE source_raw_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS appointments_tenant_at_idx
  ON public.appointments (tenant_id, appointment_at DESC);
CREATE INDEX IF NOT EXISTS appointments_tenant_doctor_at_idx
  ON public.appointments (tenant_id, doctor_id, appointment_at DESC);
CREATE INDEX IF NOT EXISTS appointments_tenant_plan_at_idx
  ON public.appointments (tenant_id, plan_id, appointment_at DESC);

-- Reversals (FR-027–32). Exactly one reversal per appointment.
CREATE TABLE IF NOT EXISTS public.appointment_reversals (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  appointment_id           UUID NOT NULL REFERENCES public.appointments(id) ON DELETE RESTRICT,
  reversal_amount_cents    BIGINT NOT NULL CHECK (reversal_amount_cents < 0),
  reason                   TEXT NOT NULL CHECK (char_length(reason) >= 3),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by               UUID NOT NULL,
  UNIQUE (tenant_id, appointment_id)
);

-- Effective-status view (FR-029, FR-030): never stored, always computed.
CREATE OR REPLACE VIEW public.appointments_effective AS
SELECT
  a.*,
  CASE WHEN r.id IS NULL THEN 'ativo' ELSE 'estornado' END           AS effective_status,
  (a.frozen_amount_cents + COALESCE(r.reversal_amount_cents, 0))     AS net_amount_cents,
  (
    (a.frozen_amount_cents + COALESCE(r.reversal_amount_cents, 0))
    * a.frozen_commission_bps / 10000
  )                                                                   AS net_commission_cents,
  r.id         AS reversal_id,
  r.created_at AS reversed_at
FROM public.appointments a
LEFT JOIN public.appointment_reversals r ON r.appointment_id = a.id;

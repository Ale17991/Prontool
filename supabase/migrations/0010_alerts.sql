-- T022: Operational alerts + resolution trail (FR-033–37).

CREATE TABLE IF NOT EXISTS public.alerts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  type                 TEXT NOT NULL CHECK (
    type IN ('dlq_event', 'webhook_rejected', 'tuss_deprecated', 'signature_failure', 'rbac_denied')
  ),
  subject_ref          JSONB,
  detail               JSONB NOT NULL,   -- no PII; see FR-037
  status               TEXT NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto', 'resolvido')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at          TIMESTAMPTZ,
  resolved_by          UUID,
  email_sent_to        TEXT[] NOT NULL DEFAULT '{}',
  email_last_sent_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS alerts_dashboard_idx
  ON public.alerts (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS alerts_dedup_idx
  ON public.alerts (tenant_id, type, (subject_ref::text));

-- Append-only resolution transitions.
CREATE TABLE IF NOT EXISTS public.alert_status_transitions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id         UUID NOT NULL REFERENCES public.alerts(id) ON DELETE RESTRICT,
  tenant_id        UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  from_status      TEXT,
  to_status        TEXT NOT NULL,
  actor            UUID,
  reason           TEXT,
  transitioned_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS alert_status_transitions_alert_idx
  ON public.alert_status_transitions (alert_id, transitioned_at DESC);

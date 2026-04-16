-- T021: Raw webhook event log (append-only payload), state-transition
-- trail, and DLQ view. Keys and statuses persist in English; UI
-- translates to pt-BR.

CREATE TABLE IF NOT EXISTS public.raw_webhook_events (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  ghl_event_id              TEXT NOT NULL,
  payload                   JSONB NOT NULL,
  headers                   JSONB NOT NULL,
  received_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  processing_status         TEXT NOT NULL DEFAULT 'pending'
    CHECK (processing_status IN ('pending', 'processing', 'done', 'dlq', 'reprocessed')),
  last_processed_at         TIMESTAMPTZ,
  processing_attempt_count  INTEGER NOT NULL DEFAULT 0 CHECK (processing_attempt_count >= 0),
  UNIQUE (tenant_id, ghl_event_id)
);

CREATE INDEX IF NOT EXISTS raw_webhook_events_status_idx
  ON public.raw_webhook_events (tenant_id, processing_status, received_at DESC);

-- Now that both tables exist, wire the FK from appointments → raw events.
ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_source_raw_event_fk
  FOREIGN KEY (source_raw_event_id) REFERENCES public.raw_webhook_events(id) ON DELETE RESTRICT;

-- Append-only transition trail.
CREATE TABLE IF NOT EXISTS public.webhook_event_transitions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  raw_event_id    UUID NOT NULL REFERENCES public.raw_webhook_events(id) ON DELETE RESTRICT,
  from_status     TEXT,
  to_status       TEXT NOT NULL,
  reason          TEXT,
  transitioned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor           TEXT
);

CREATE INDEX IF NOT EXISTS webhook_event_transitions_event_idx
  ON public.webhook_event_transitions (raw_event_id, transitioned_at DESC);

-- DLQ view: events currently parked for human intervention.
CREATE OR REPLACE VIEW public.dlq_events AS
SELECT
  r.*,
  (
    SELECT t.reason FROM public.webhook_event_transitions t
    WHERE t.raw_event_id = r.id AND t.to_status = 'dlq'
    ORDER BY t.transitioned_at DESC LIMIT 1
  ) AS failure_reason
FROM public.raw_webhook_events r
WHERE r.processing_status = 'dlq';

-- T023: Immutable audit log (Principle II).
-- CHECK constraint enforces the enum including 'conflict' (FR-005b, M6).

CREATE TABLE IF NOT EXISTS public.audit_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  actor_id       UUID,
  actor_label    TEXT,
  timestamp_utc  TIMESTAMPTZ NOT NULL DEFAULT now(),
  entity         TEXT NOT NULL,
  entity_id      UUID,
  field          TEXT,
  old_value      TEXT,
  new_value      TEXT,
  reason         TEXT,
  ip             INET,
  user_agent     TEXT,
  result         TEXT NOT NULL DEFAULT 'success'
    CHECK (result IN ('success', 'denied', 'conflict'))
);

CREATE INDEX IF NOT EXISTS audit_log_tenant_ts_idx
  ON public.audit_log (tenant_id, timestamp_utc DESC);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx
  ON public.audit_log (tenant_id, entity, timestamp_utc DESC);

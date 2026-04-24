-- T-manual-patients: support manual patient creation (independent of GHL webhook).
-- 1) Allow patients.ghl_contact_id to be NULL while a GHL sync is pending.
--    The existing UNIQUE (tenant_id, ghl_contact_id) continues to apply only
--    to non-NULL values (PG treats NULLs as distinct in UNIQUE by default).
-- 2) Add 'ghl_sync_failed' to alerts.type so ops is notified when we save a
--    patient locally but the GHL contact create call failed.

ALTER TABLE public.patients
  ALTER COLUMN ghl_contact_id DROP NOT NULL;

ALTER TABLE public.alerts
  DROP CONSTRAINT IF EXISTS alerts_type_check;

ALTER TABLE public.alerts
  ADD CONSTRAINT alerts_type_check CHECK (
    type IN (
      'dlq_event',
      'webhook_rejected',
      'tuss_deprecated',
      'signature_failure',
      'rbac_denied',
      'ghl_sync_failed'
    )
  );

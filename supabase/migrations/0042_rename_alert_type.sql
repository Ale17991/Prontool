-- Feature 002: rename alerts.type 'ghl_sync_failed' -> 'integration_sync_failed'
-- so the same alert type serves any provider (HubSpot, RD Station, etc.)
-- with provider specified in detail.provider.

UPDATE public.alerts
   SET type = 'integration_sync_failed'
 WHERE type = 'ghl_sync_failed';

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
      'integration_sync_failed'
    )
  );

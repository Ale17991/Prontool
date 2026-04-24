-- ============================================================================
-- ⚠️  DO NOT APPLY THIS MIGRATION YET.
-- ============================================================================
--
-- `tenant_ghl_config` is still read by the GHL ingestion worker pipeline
-- (src/lib/core/appointments/create-from-event.ts line ~55, and the field
-- maps used by src/lib/integrations/ghl/extract-custom-fields.ts).
-- Migration 0040 already copies into `tenant_integrations` the minimum
-- needed for the INBOUND webhook route — but the WORKER path still relies
-- on the legacy table's field_map_patient_* columns (not captured in the
-- new tenant_integrations.config shape for GHL).
--
-- Apply this migration only after:
--   1. `create-from-event.ts` and `extract-custom-fields.ts` migrate to
--      read their field maps from `tenant_integrations.config` (requires
--      extending the GHL adapter's configSchema with field_map_patient_*
--      entries, plus a backfill step to copy them into existing rows).
--   2. All environment deploys running migration 0040 have been verified
--      stable (rollback window passed).
--   3. Grep `src/**/*.ts` confirms zero remaining references to
--      `tenant_ghl_config` outside of data-access migration files.
--
-- Until then: `pnpm supabase:reset` skips this file because it's the last
-- timestamp. Renaming to 0050+ keeps it ahead of future cleanup.
-- ============================================================================

-- DROP TABLE IF EXISTS public.tenant_ghl_config;

-- Placeholder comment so the file is valid SQL but applies no changes.
SELECT 'NOOP — see comment block above.';

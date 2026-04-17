-- Test-support helpers. Safe to ship (just utility functions, no data).
-- `enc_text_with_key` lets integration tests encrypt with an explicit key
-- instead of the per-session GUC (`app.patient_encryption_key`) so we can
-- seed rows (`tenant_ghl_config.webhook_secret_enc`, patient PII) that the
-- production handler decrypts later using the same env-sourced key.

CREATE OR REPLACE FUNCTION public.enc_text_with_key(plain TEXT, key TEXT)
RETURNS BYTEA LANGUAGE sql VOLATILE AS $$
  SELECT CASE
    WHEN plain IS NULL THEN NULL
    ELSE extensions.pgp_sym_encrypt(plain, key)
  END
$$;

CREATE OR REPLACE FUNCTION public.dec_text_with_key(cipher BYTEA, key TEXT)
RETURNS TEXT LANGUAGE sql VOLATILE AS $$
  SELECT CASE
    WHEN cipher IS NULL THEN NULL
    ELSE extensions.pgp_sym_decrypt(cipher, key)
  END
$$;

-- Test-only truncate. Wipes every mutable tenant-scoped table in one go so
-- integration tests start from a known-empty state regardless of FK order,
-- composite PKs, or append-only triggers. Runs as SECURITY DEFINER against
-- the function owner (postgres on the local CLI stack) so the
-- enforce_append_only trigger exempts us. `tuss_codes` /
-- `tuss_catalog_versions` are deliberately preserved — the catalog is
-- expensive to re-seed and tests that need to wipe it opt in via
-- `wipeCatalog: true` in the TS helper.
CREATE OR REPLACE FUNCTION public.test_truncate_all_mutable(wipe_catalog BOOLEAN DEFAULT FALSE)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  TRUNCATE
    public.audit_log,
    public.alert_status_transitions,
    public.alerts,
    public.webhook_event_transitions,
    public.raw_webhook_events,
    public.appointment_reversals,
    public.appointments,
    public.price_versions,
    public.doctor_commission_history,
    public.doctors,
    public.patients,
    public.procedures,
    public.health_plans,
    public.tenant_ghl_config,
    public.user_tenants,
    public.tenants
  RESTART IDENTITY CASCADE;

  IF wipe_catalog THEN
    TRUNCATE public.tuss_codes, public.tuss_catalog_versions RESTART IDENTITY CASCADE;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.test_truncate_all_mutable(BOOLEAN) TO service_role;

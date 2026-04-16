-- T019: Patients with column-level symmetric encryption for LGPD-sensitive
-- fields (FR-010a, SC-011). Encryption key lives in env
-- PATIENT_DATA_ENCRYPTION_KEY and is set per-session via a GUC.

-- ---- Key retrieval helper --------------------------------------------------
-- The Supabase instance is configured to expose the key as a custom GUC
-- (app.patient_encryption_key). The application layer sets it via
-- `SET LOCAL app.patient_encryption_key = '...'` at the start of each
-- transaction that touches patient data. A fallback of an empty string
-- causes enc/dec to raise, making misconfiguration loud.
CREATE OR REPLACE FUNCTION public.patient_enc_key()
RETURNS TEXT LANGUAGE plpgsql STABLE AS $$
DECLARE
  k TEXT;
BEGIN
  BEGIN
    k := current_setting('app.patient_encryption_key', TRUE);
  EXCEPTION WHEN OTHERS THEN
    k := NULL;
  END;
  IF k IS NULL OR length(k) = 0 THEN
    RAISE EXCEPTION 'patient_encryption_key not set for session';
  END IF;
  RETURN k;
END $$;

-- ---- Wrapper functions -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.enc_text(plain TEXT)
RETURNS BYTEA LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN plain IS NULL THEN NULL
    ELSE extensions.pgp_sym_encrypt(plain, public.patient_enc_key())
  END
$$;

CREATE OR REPLACE FUNCTION public.dec_text(cipher BYTEA)
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN cipher IS NULL THEN NULL
    ELSE extensions.pgp_sym_decrypt(cipher, public.patient_enc_key())
  END
$$;

-- ---- Patient table ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.patients (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  ghl_contact_id   TEXT NOT NULL,
  full_name_enc    BYTEA NOT NULL,
  cpf_enc          BYTEA NOT NULL,
  phone_enc        BYTEA,
  email_enc        BYTEA,
  birth_date_enc   BYTEA,
  anonymized_at    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, ghl_contact_id)
);

CREATE INDEX IF NOT EXISTS patients_tenant_contact_idx
  ON public.patients (tenant_id, ghl_contact_id);

DROP TRIGGER IF EXISTS patients_touch_updated_at ON public.patients;
CREATE TRIGGER patients_touch_updated_at
  BEFORE UPDATE ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

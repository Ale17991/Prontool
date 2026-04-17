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

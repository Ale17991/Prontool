-- T013: Core Postgres extensions required by the billing platform.
-- pgcrypto: gen_random_uuid(), symmetric encryption for patient PII.
-- pg_trgm (optional): fuzzy search for procedures/patients by name.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- pgsodium is preferred for sealed-box encryption but unavailable in some
-- Supabase regions. We fall back to pgcrypto. The downstream patient
-- encryption functions (0007_patients.sql) are written against pgcrypto
-- to keep behavior portable.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pgsodium') THEN
    CREATE EXTENSION IF NOT EXISTS pgsodium WITH SCHEMA pgsodium;
  END IF;
END $$;

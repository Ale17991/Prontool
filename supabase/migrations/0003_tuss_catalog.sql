-- T015: Global TUSS catalog. No RLS: this is authoritative reference data
-- readable by all tenants. Only the platform operator (service-role) can
-- write. Enforces Principle IV (conformidade TUSS/ANS).

CREATE TABLE IF NOT EXISTS public.tuss_catalog_versions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_ref   TEXT NOT NULL,                       -- git commit SHA of charlesfgarcia/tabelas-ans
  imported_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  imported_by  UUID,                                -- auth.users id of the platform operator
  content_hash TEXT NOT NULL,                       -- SHA256 of the normalized dump
  code_count   INTEGER NOT NULL CHECK (code_count >= 0),
  notes        TEXT
);

CREATE TABLE IF NOT EXISTS public.tuss_codes (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                       TEXT NOT NULL UNIQUE,
  description                TEXT NOT NULL,
  terminology_chapter        TEXT,
  valid_from                 DATE NOT NULL,
  valid_to                   DATE,                 -- NULL = still valid
  source_catalog_version_id  UUID NOT NULL REFERENCES public.tuss_catalog_versions(id) ON DELETE RESTRICT,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tuss_codes_code_idx ON public.tuss_codes (code);
CREATE INDEX IF NOT EXISTS tuss_codes_vigencia_idx ON public.tuss_codes (valid_from, valid_to);

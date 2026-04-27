-- 0050 — Tabela cid10_codes (catálogo público da OMS adotado pela OMS-BR
-- via DataSUS). Compartilhado entre tenants — não tem tenant_id, é dado
-- de referência. Equivalente ao tuss_codes mas pra CIDs (diagnósticos).
--
-- Seed via scripts/seed-cid10.ts (similar ao seed-tuss.ts).

CREATE TABLE IF NOT EXISTS public.cid10_codes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code         TEXT NOT NULL UNIQUE,
  description  TEXT NOT NULL,
  chapter      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cid10_code_idx ON public.cid10_codes (code);

-- Full-text search em PT-BR sobre code + description.
-- Equivale ao que tuss_codes faz pra TUSS — busca por código exato OU
-- descrição com tokenização portuguesa.
CREATE INDEX IF NOT EXISTS cid10_search_idx
  ON public.cid10_codes
  USING gin (to_tsvector('portuguese', code || ' ' || description));

ALTER TABLE public.cid10_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cid10_codes_read ON public.cid10_codes;
CREATE POLICY cid10_codes_read ON public.cid10_codes FOR SELECT
  USING (TRUE);

GRANT SELECT ON public.cid10_codes TO authenticated;
GRANT INSERT ON public.cid10_codes TO service_role;

NOTIFY pgrst, 'reload schema';

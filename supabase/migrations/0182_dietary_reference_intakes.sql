-- 0182 — DRIs (Dietary Reference Intakes) — feature 049 US2.
--
-- Catálogo GLOBAL (tenant_id NULL, read-only pela clínica) de recomendação de
-- ingestão por nutriente × sexo × faixa etária × estado. Usado como alvo na
-- análise de adequação (total do plano/recordatório ÷ DRI). Fonte: aba `BD_DRIs`
-- da Evonut (bloco RDA/AI), semeada por `scripts/build-dris-seed.ts`.
--
-- Sem tenant_id (compartilhado por todas as clínicas). Não é registrado no
-- catalog_baseline; o seed é re-executável (local re-semeia após reset; prod
-- não reseta). Testes de adequação inserem os próprios DRIs (self-contained).
--
-- Constituição: III (catálogo global, RLS read-only). Reversível/idempotente.

CREATE TABLE IF NOT EXISTS public.dietary_reference_intakes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nutrient_key   TEXT NOT NULL,
  sex            TEXT NOT NULL CHECK (sex IN ('M','F','any')),
  age_min_years  NUMERIC(6,2) NOT NULL,
  age_max_years  NUMERIC(6,2) NOT NULL,
  state          TEXT NOT NULL DEFAULT 'padrao' CHECK (state IN ('padrao','gestante','lactante')),
  value          NUMERIC(12,4) NOT NULL CHECK (value >= 0),
  unit           TEXT NOT NULL,
  source_label   TEXT NULL,
  CONSTRAINT dri_natural_key UNIQUE (nutrient_key, sex, age_min_years, age_max_years, state)
);

CREATE INDEX IF NOT EXISTS dri_lookup_idx
  ON public.dietary_reference_intakes (nutrient_key, sex, state);

ALTER TABLE public.dietary_reference_intakes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dri_read ON public.dietary_reference_intakes;
CREATE POLICY dri_read ON public.dietary_reference_intakes
  FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.dietary_reference_intakes TO authenticated, service_role;

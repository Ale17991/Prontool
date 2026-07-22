-- 0176 — Catálogo de alimentos + Plano Alimentar (feature 047).
--
-- Dá corpo ao módulo `dieta`: uma base de alimentos com nutrientes (catálogo
-- GLOBAL somente-leitura + alimentos próprios por clínica, no padrão da 0123)
-- alimenta a montagem de um cardápio por refeições, com soma automática e
-- comparação com a meta da Avaliação Nutricional (046). A prescrição vira um
-- retrato imutável (snapshot JSONB, append-only) entregue no portal.
--
-- ESTENDE (não recria) as tabelas diet_plans/diet_meals/diet_meal_items da
-- 0122, já em produção — todas as colunas novas são aditivas/nullable.
--
-- Constituição: I imutabilidade (prescrição append-only + congelamento de
-- nutrientes); II auditoria (log_audit_event); III multi-tenant (tenant_id +
-- RLS, catálogo global tenant_id NULL); V RBAC (escrita admin/profissional).
-- Reversibilidade: aditiva, idempotente. supabase:reset recria.
--
-- Fontes do catálogo global (ver specs/047/research.md D1): IBGE/POF 2008-2009
-- (espinha dorsal, única base pública com medida caseira de licença utilizável)
-- + TACO 4ª ed. (NEPA/UNICAMP, 2011) sobreposta. A atribuição das fontes é
-- OBRIGAÇÃO DE LICENÇA (TACO) e é exibida na UI/exportações (FR-020).

-- =========================================================================
-- 0. Extensões — busca textual tolerante a acento (research D5)
-- =========================================================================

-- pg_trgm já vem instalada no Supabase; unaccent não. Ambas no schema extensions.
CREATE EXTENSION IF NOT EXISTS pg_trgm  WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

-- unaccent() não é IMMUTABLE por padrão (depende de dicionário) → Postgres recusa
-- índice sobre ela. Wrapper IMMUTABLE com o dicionário fixado torna indexável.
CREATE OR REPLACE FUNCTION public.immutable_unaccent(text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
SET search_path = extensions, public
AS $$ SELECT extensions.unaccent('extensions.unaccent', $1) $$;

-- =========================================================================
-- 1. Grupos alimentares — catálogo global (sem tenant_id: conjunto estável)
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.food_groups (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT NOT NULL UNIQUE CHECK (length(slug) BETWEEN 1 AND 40),
  label         TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 60),
  display_order INT  NOT NULL DEFAULT 0,
  active        BOOLEAN NOT NULL DEFAULT TRUE
);

ALTER TABLE public.food_groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS food_groups_read ON public.food_groups;
CREATE POLICY food_groups_read ON public.food_groups
  FOR SELECT TO authenticated USING (TRUE);
GRANT SELECT ON public.food_groups TO authenticated;

-- =========================================================================
-- 2. Alimentos — global (tenant_id NULL) OU próprio da clínica (padrão 0123)
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.foods (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  source             TEXT NOT NULL CHECK (source IN ('taco','ibge_pof','tbca','custom')),
  external_code      TEXT NULL,
  name               TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  group_id           UUID NULL REFERENCES public.food_groups(id),
  reference_grams    NUMERIC(8,2) NOT NULL DEFAULT 100 CHECK (reference_grams > 0),
  energy_kcal        NUMERIC(8,2) NOT NULL CHECK (energy_kcal BETWEEN 0 AND 1000),
  protein_g          NUMERIC(8,2) NOT NULL DEFAULT 0 CHECK (protein_g BETWEEN 0 AND 100),
  carb_g             NUMERIC(8,2) NOT NULL DEFAULT 0 CHECK (carb_g BETWEEN 0 AND 100),
  fat_g              NUMERIC(8,2) NOT NULL DEFAULT 0 CHECK (fat_g BETWEEN 0 AND 100),
  fiber_g            NUMERIC(8,2) NULL CHECK (fiber_g IS NULL OR fiber_g BETWEEN 0 AND 100),
  micros             JSONB NOT NULL DEFAULT '{}',
  active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id UUID NULL REFERENCES auth.users(id)
);

COMMENT ON COLUMN public.foods.tenant_id IS
  'NULL = alimento global do catálogo (somente-leitura). Não-NULL = alimento próprio da clínica.';
COMMENT ON COLUMN public.foods.source IS
  'Proveniência: taco | ibge_pof (bases oficiais, atribuição obrigatória) | tbca | custom (clínica).';

-- Faixas plausíveis são por porção de referência (padrão 100 g). Óleo puro
-- ≈ 884 kcal/100 g → teto 1000 acomoda; anti-erro de digitação, não normalidade.

CREATE INDEX IF NOT EXISTS foods_list_idx
  ON public.foods (tenant_id, active, name);

-- Busca textual: trigram sobre o nome sem acento, tolerante a erro de digitação.
CREATE INDEX IF NOT EXISTS foods_name_trgm_idx
  ON public.foods USING gin (public.immutable_unaccent(lower(name)) extensions.gin_trgm_ops);

-- Idempotência do seed global (re-seed em prod não duplica).
CREATE UNIQUE INDEX IF NOT EXISTS foods_global_source_code_uidx
  ON public.foods (source, external_code) WHERE tenant_id IS NULL AND external_code IS NOT NULL;

ALTER TABLE public.foods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS foods_read ON public.foods;
CREATE POLICY foods_read ON public.foods
  FOR SELECT TO authenticated
  USING (tenant_id IS NULL OR tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS foods_custom_insert ON public.foods;
CREATE POLICY foods_custom_insert ON public.foods
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN ('admin','profissional_saude'));

DROP POLICY IF EXISTS foods_custom_update ON public.foods;
CREATE POLICY foods_custom_update ON public.foods
  FOR UPDATE TO authenticated
  USING (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN ('admin','profissional_saude'))
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN ('admin','profissional_saude'));

DROP POLICY IF EXISTS foods_custom_delete ON public.foods;
CREATE POLICY foods_custom_delete ON public.foods
  FOR DELETE TO authenticated
  USING (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN ('admin','profissional_saude'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.foods TO authenticated;

-- Append-only só nas linhas GLOBAIS (padrão 0123): o seed é imutável; alimento
-- próprio a clínica edita/desativa.
DROP TRIGGER IF EXISTS foods_enforce_global_readonly ON public.foods;
CREATE TRIGGER foods_enforce_global_readonly
  BEFORE UPDATE OR DELETE ON public.foods
  FOR EACH ROW WHEN (OLD.tenant_id IS NULL)
  EXECUTE FUNCTION public.enforce_append_only();

-- Auditoria de alimento próprio (FR-018) — só linhas com tenant.
CREATE OR REPLACE FUNCTION public.audit_food()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF COALESCE(NEW.tenant_id, OLD.tenant_id) IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  PERFORM public.log_audit_event(
    COALESCE(NEW.tenant_id, OLD.tenant_id), 'foods', COALESCE(NEW.id, OLD.id),
    lower(TG_OP), NULL,
    json_build_object('name', COALESCE(NEW.name, OLD.name), 'source', COALESCE(NEW.source, OLD.source))::text,
    'feature 047 — alimento próprio da clínica');
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS foods_audit ON public.foods;
CREATE TRIGGER foods_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.foods
  FOR EACH ROW EXECUTE FUNCTION public.audit_food();

-- =========================================================================
-- 3. Medidas caseiras (FR-008/FR-012)
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.food_household_measures (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  food_id    UUID NOT NULL REFERENCES public.foods(id) ON DELETE CASCADE,
  tenant_id  UUID NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  label      TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 60),
  grams      NUMERIC(8,2) NOT NULL CHECK (grams > 0),
  is_default BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS food_measures_food_idx ON public.food_household_measures (food_id);

ALTER TABLE public.food_household_measures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS food_measures_read ON public.food_household_measures;
CREATE POLICY food_measures_read ON public.food_household_measures
  FOR SELECT TO authenticated
  USING (tenant_id IS NULL OR tenant_id = public.jwt_tenant_id());
DROP POLICY IF EXISTS food_measures_write ON public.food_household_measures;
CREATE POLICY food_measures_write ON public.food_household_measures
  FOR ALL TO authenticated
  USING (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN ('admin','profissional_saude'))
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN ('admin','profissional_saude'));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.food_household_measures TO authenticated;

DROP TRIGGER IF EXISTS food_measures_enforce_global_readonly ON public.food_household_measures;
CREATE TRIGGER food_measures_enforce_global_readonly
  BEFORE UPDATE OR DELETE ON public.food_household_measures
  FOR EACH ROW WHEN (OLD.tenant_id IS NULL)
  EXECUTE FUNCTION public.enforce_append_only();

-- =========================================================================
-- 4. Listas de substituição / equivalentes (US3, FR-014/FR-015)
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.food_equivalence_lists (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  group_id       UUID NOT NULL REFERENCES public.food_groups(id),
  name           TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  reference_kcal NUMERIC(8,2) NULL,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS food_equiv_lists_idx ON public.food_equivalence_lists (tenant_id, group_id);

CREATE TABLE IF NOT EXISTS public.food_equivalence_items (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id   UUID NOT NULL REFERENCES public.food_equivalence_lists(id) ON DELETE CASCADE,
  tenant_id UUID NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  food_id   UUID NOT NULL REFERENCES public.foods(id),
  grams     NUMERIC(8,2) NOT NULL CHECK (grams > 0)
);
CREATE INDEX IF NOT EXISTS food_equiv_items_list_idx ON public.food_equivalence_items (list_id);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['food_equivalence_lists','food_equivalence_items'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_read ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_read ON public.%I FOR SELECT TO authenticated USING (tenant_id IS NULL OR tenant_id = public.jwt_tenant_id())',
      t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_write ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_write ON public.%I FOR ALL TO authenticated USING (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN (''admin'',''profissional_saude'')) WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN (''admin'',''profissional_saude''))',
      t, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I_global_readonly ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER %I_global_readonly BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW WHEN (OLD.tenant_id IS NULL) EXECUTE FUNCTION public.enforce_append_only()',
      t, t);
  END LOOP;
END $$;

-- =========================================================================
-- 5. Extensão das tabelas diet_* (0122) — aditivo, sem quebrar dado legado
-- =========================================================================

ALTER TABLE public.diet_plans
  ADD COLUMN IF NOT EXISTS status        TEXT NOT NULL DEFAULT 'rascunho'
    CHECK (status IN ('rascunho','prescrito')),
  ADD COLUMN IF NOT EXISTS assessment_id UUID NULL REFERENCES public.nutrition_assessments(id),
  ADD COLUMN IF NOT EXISTS target_kcal   NUMERIC(8,2) NULL,
  ADD COLUMN IF NOT EXISTS target_macros JSONB NULL;

ALTER TABLE public.diet_meal_items
  ADD COLUMN IF NOT EXISTS food_id             UUID NULL REFERENCES public.foods(id),
  ADD COLUMN IF NOT EXISTS grams               NUMERIC(8,2) NULL CHECK (grams IS NULL OR (grams > 0 AND grams <= 5000)),
  ADD COLUMN IF NOT EXISTS measure_label       TEXT NULL,
  ADD COLUMN IF NOT EXISTS measure_qty         NUMERIC(8,2) NULL,
  ADD COLUMN IF NOT EXISTS equivalence_list_id UUID NULL REFERENCES public.food_equivalence_lists(id),
  ADD COLUMN IF NOT EXISTS snap_energy_kcal    NUMERIC(8,2) NULL,
  ADD COLUMN IF NOT EXISTS snap_protein_g      NUMERIC(8,2) NULL,
  ADD COLUMN IF NOT EXISTS snap_carb_g         NUMERIC(8,2) NULL,
  ADD COLUMN IF NOT EXISTS snap_fat_g          NUMERIC(8,2) NULL,
  ADD COLUMN IF NOT EXISTS snap_fiber_g        NUMERIC(8,2) NULL;

-- =========================================================================
-- 6. Prescrição — retrato imutável (Princípio I), fonte da verdade do portal
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.diet_plan_prescriptions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  patient_id            UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  plan_id               UUID NOT NULL REFERENCES public.diet_plans(id) ON DELETE CASCADE,
  prescribed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  prescribed_by_user_id UUID NOT NULL REFERENCES auth.users(id),
  snapshot              JSONB NOT NULL,
  target_kcal           NUMERIC(8,2) NULL,
  target_macros         JSONB NULL,
  total_kcal            NUMERIC(8,2) NOT NULL,
  total_macros          JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS diet_prescriptions_patient_idx
  ON public.diet_plan_prescriptions (tenant_id, patient_id, prescribed_at DESC);

ALTER TABLE public.diet_plan_prescriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS diet_prescriptions_read ON public.diet_plan_prescriptions;
CREATE POLICY diet_prescriptions_read ON public.diet_plan_prescriptions
  FOR SELECT TO authenticated USING (tenant_id = public.jwt_tenant_id());
DROP POLICY IF EXISTS diet_prescriptions_insert ON public.diet_plan_prescriptions;
CREATE POLICY diet_prescriptions_insert ON public.diet_plan_prescriptions
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN ('admin','profissional_saude'));

REVOKE UPDATE, DELETE ON public.diet_plan_prescriptions FROM authenticated;
GRANT SELECT, INSERT ON public.diet_plan_prescriptions TO authenticated;

DROP TRIGGER IF EXISTS diet_prescriptions_append_only ON public.diet_plan_prescriptions;
CREATE TRIGGER diet_prescriptions_append_only
  BEFORE UPDATE OR DELETE ON public.diet_plan_prescriptions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only();

CREATE OR REPLACE FUNCTION public.audit_diet_prescription()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.log_audit_event(
    NEW.tenant_id, 'diet_plan_prescriptions', NEW.id, 'created', NULL,
    json_build_object('patient_id', NEW.patient_id, 'plan_id', NEW.plan_id,
                      'total_kcal', NEW.total_kcal)::text,
    'feature 047 — plano alimentar prescrito');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS diet_prescriptions_audit ON public.diet_plan_prescriptions;
CREATE TRIGGER diet_prescriptions_audit
  AFTER INSERT ON public.diet_plan_prescriptions
  FOR EACH ROW EXECUTE FUNCTION public.audit_diet_prescription();

-- =========================================================================
-- 7. SEED do catálogo global — placeholder (grupos mínimos)
-- =========================================================================
-- O seed completo (POF + TACO + medidas caseiras, ~14 mil linhas) é aplicado
-- por bloco COPY gerado dos CSVs oficiais — ver tarefa T009 (anexado a esta
-- migration). Aqui deixamos apenas os grupos alimentares, que a normalização
-- referencia por slug. A ingestão de alimentos vem logo abaixo (COPY).

INSERT INTO public.food_groups (slug, label, display_order) VALUES
  ('cereais_paes',   'Cereais e pães',          1),
  ('leguminosas',    'Leguminosas',             2),
  ('verduras',       'Verduras e legumes',      3),
  ('frutas',         'Frutas',                  4),
  ('carnes_ovos',    'Carnes e ovos',           5),
  ('leite_deriv',    'Leite e derivados',       6),
  ('oleos_gorduras', 'Óleos e gorduras',        7),
  ('acucares',       'Açúcares e doces',        8),
  ('oleaginosas',    'Oleaginosas',             9),
  ('bebidas',        'Bebidas',                10),
  ('outros',         'Outros',                 99)
ON CONFLICT (slug) DO NOTHING;

-- <<< SEED_FOODS_COPY >>>  (marcador — bloco COPY dos alimentos entra aqui na T009)

-- =========================================================================
-- 8. catalog_baseline — o catálogo de alimentos sobrevive ao reset dos testes
-- =========================================================================
-- Gotcha 0170: test_truncate_all_mutable TRUNCA todo o public e restaura os
-- catálogos de um snapshot. Sem registrar as tabelas de alimentos aqui, elas
-- sumiriam a cada reset. Reescrevemos a função incluindo-as (captura lazy +
-- restauração em ordem de FK) e damos refresh se o baseline já existir.

CREATE OR REPLACE FUNCTION public.test_truncate_all_mutable(wipe_catalog BOOLEAN DEFAULT FALSE)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
SET statement_timeout = '0'
AS $$
DECLARE
  v_list TEXT;
  v_ready BOOLEAN;
  v_cat TEXT;
  v_cols TEXT;
  v_cats TEXT[];
BEGIN
  CREATE SCHEMA IF NOT EXISTS catalog_baseline;
  SELECT to_regclass('catalog_baseline._ready') IS NOT NULL INTO v_ready;
  IF NOT v_ready THEN
    CREATE TABLE catalog_baseline.tuss_catalog_versions   AS TABLE public.tuss_catalog_versions;
    CREATE TABLE catalog_baseline.tuss_codes              AS TABLE public.tuss_codes;
    CREATE TABLE catalog_baseline.dental_status_catalog   AS TABLE public.dental_status_catalog;
    CREATE TABLE catalog_baseline.cid10_codes             AS TABLE public.cid10_codes;
    CREATE TABLE catalog_baseline.tiss_domain_tables      AS TABLE public.tiss_domain_tables;
    CREATE TABLE catalog_baseline.patient_metric_types    AS TABLE public.patient_metric_types;
    CREATE TABLE catalog_baseline.plan_prices             AS TABLE public.plan_prices;
    CREATE TABLE catalog_baseline.platform_admins         AS TABLE public.platform_admins;
    CREATE TABLE catalog_baseline.food_groups             AS TABLE public.food_groups;
    CREATE TABLE catalog_baseline.foods                   AS TABLE public.foods;
    CREATE TABLE catalog_baseline.food_household_measures AS TABLE public.food_household_measures;
    CREATE TABLE catalog_baseline.food_equivalence_lists  AS TABLE public.food_equivalence_lists;
    CREATE TABLE catalog_baseline.food_equivalence_items  AS TABLE public.food_equivalence_items;
    CREATE TABLE catalog_baseline._ready ();
  END IF;

  SELECT string_agg(format('public.%I', c.relname), ', ')
    INTO v_list
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e'
    );
  IF v_list IS NOT NULL THEN
    EXECUTE 'TRUNCATE ' || v_list || ' RESTART IDENTITY CASCADE';
  END IF;

  -- Ordem de FK: food_groups → foods → medidas/listas → itens de equivalência.
  IF wipe_catalog THEN
    v_cats := ARRAY['dental_status_catalog', 'cid10_codes', 'tiss_domain_tables',
                    'patient_metric_types', 'plan_prices', 'platform_admins',
                    'food_groups', 'foods', 'food_household_measures',
                    'food_equivalence_lists', 'food_equivalence_items'];
  ELSE
    v_cats := ARRAY['tuss_catalog_versions', 'tuss_codes', 'dental_status_catalog',
                    'cid10_codes', 'tiss_domain_tables', 'patient_metric_types',
                    'plan_prices', 'platform_admins',
                    'food_groups', 'foods', 'food_household_measures',
                    'food_equivalence_lists', 'food_equivalence_items'];
  END IF;

  FOREACH v_cat IN ARRAY v_cats LOOP
    SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum)
      INTO v_cols
    FROM pg_attribute
    WHERE attrelid = ('public.' || v_cat)::regclass
      AND attnum > 0 AND NOT attisdropped AND attgenerated = '';
    EXECUTE format(
      'INSERT INTO public.%I (%s) SELECT %s FROM catalog_baseline.%I',
      v_cat, v_cols, v_cols, v_cat
    );
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.test_truncate_all_mutable(BOOLEAN) TO service_role;

-- Refresh do baseline em DB local que já capturou o snapshot ANTES desta
-- migration: cria as tabelas de alimentos no baseline com o estado semeado
-- agora. Em DB fresco (CI) o bloco acima captura tudo e este é no-op.
DO $$ BEGIN
  IF to_regclass('catalog_baseline._ready') IS NOT NULL
     AND to_regclass('catalog_baseline.foods') IS NULL THEN
    CREATE TABLE catalog_baseline.food_groups             AS TABLE public.food_groups;
    CREATE TABLE catalog_baseline.foods                   AS TABLE public.foods;
    CREATE TABLE catalog_baseline.food_household_measures AS TABLE public.food_household_measures;
    CREATE TABLE catalog_baseline.food_equivalence_lists  AS TABLE public.food_equivalence_lists;
    CREATE TABLE catalog_baseline.food_equivalence_items  AS TABLE public.food_equivalence_items;
  END IF;
END $$;

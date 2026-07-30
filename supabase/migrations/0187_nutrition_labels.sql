-- 0186 — Rótulo nutricional de produto (feature 052).
--
-- A nutricionista presta consultoria para quem VENDE comida: monta um preparo
-- com ingredientes e quantidades e gera a tabela "INFORMAÇÃO NUTRICIONAL" da
-- embalagem, conforme IN 75/2020 e RDC 429/2020.
--
-- O rótulo NÃO pertence a paciente nenhum — é o produto de um cliente da
-- clínica. Por isso tabelas próprias, sem patient_id, e sem reuso de diet_plans
-- (que carrega refeições, prescrição, meta do paciente e entrega no portal,
-- nada disso aplicável aqui). Ver research.md D7.
--
-- Os nutrientes NÃO precisam de coluna nova: gorduras saturadas, trans,
-- açúcares totais e adicionados já vivem no JSONB `foods.micronutrients` desde
-- a feature 049. Os valores diários de referência e os limites da lupa são
-- constantes de código (research.md D2), não tabela.
--
-- Constituição: III multi-tenant (tenant_id + RLS); V RBAC (escrita
-- admin/profissional_saude). Idempotente.

CREATE TABLE IF NOT EXISTS public.nutrition_labels (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  product_name          TEXT NOT NULL CHECK (length(btrim(product_name)) BETWEEN 1 AND 200),
  client_name           TEXT NULL CHECK (client_name IS NULL OR length(client_name) <= 200),
  -- Sólido declara por 100 g; líquido por 100 mL. Também decide quais limites
  -- da rotulagem frontal se aplicam.
  basis                 TEXT NOT NULL DEFAULT 'solido' CHECK (basis IN ('solido','liquido')),
  -- Rendimento INFORMADO pela nutricionista, nunca deduzido da soma dos
  -- ingredientes: a perda por cocção é real (1000 g de massa crua viram ~900 g
  -- de bolo) e deduzir erraria todos os valores por porção, subdeclarando.
  total_yield           NUMERIC(10,2) NOT NULL CHECK (total_yield > 0),
  portion_size          NUMERIC(10,2) NOT NULL CHECK (portion_size > 0),
  household_measure     TEXT NULL CHECK (household_measure IS NULL OR length(household_measure) <= 80),
  portions_per_package  NUMERIC(8,2) NULL CHECK (portions_per_package IS NULL OR portions_per_package > 0),
  ingredients_text      TEXT NULL CHECK (ingredients_text IS NULL OR length(ingredients_text) <= 4000),
  allergens_text        TEXT NULL CHECK (allergens_text IS NULL OR length(allergens_text) <= 2000),
  storage_text          TEXT NULL CHECK (storage_text IS NULL OR length(storage_text) <= 2000),
  -- Sobrescritas manuais: nutrient_key -> valor por 100 g/mL. A cobertura da
  -- base é baixa para trans e açúcares (7% para açúcares adicionados), então
  -- informar à mão é o caminho principal, não a exceção.
  manual_values         JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Versão da norma usada no cálculo (FR-021): quando a referência mudar, um
  -- rótulo antigo continua explicável.
  normative_version     TEXT NOT NULL,
  created_by_user_id    UUID NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT nutrition_label_portion_chk CHECK (portion_size <= total_yield)
);

CREATE INDEX IF NOT EXISTS nutrition_labels_tenant_idx
  ON public.nutrition_labels (tenant_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.nutrition_label_ingredients (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label_id   UUID NOT NULL REFERENCES public.nutrition_labels(id) ON DELETE CASCADE,
  tenant_id  UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  food_id    UUID NOT NULL REFERENCES public.foods(id),
  grams      NUMERIC(10,2) NOT NULL CHECK (grams > 0 AND grams <= 100000),
  position   INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS nutrition_label_ingredients_label_idx
  ON public.nutrition_label_ingredients (label_id, position);

-- updated_at automático no rótulo (é rascunho de trabalho, editável).
DROP TRIGGER IF EXISTS nutrition_labels_touch ON public.nutrition_labels;
CREATE TRIGGER nutrition_labels_touch
  BEFORE UPDATE ON public.nutrition_labels
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['nutrition_labels','nutrition_label_ingredients'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_read ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_read ON public.%I FOR SELECT TO authenticated USING (tenant_id = public.jwt_tenant_id())',
      t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_write ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_write ON public.%I FOR ALL TO authenticated USING (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN (''admin'',''profissional_saude'')) WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN (''admin'',''profissional_saude''))',
      t, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

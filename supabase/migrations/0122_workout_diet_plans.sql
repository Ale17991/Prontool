-- 0121 — Feature 032: planos de TREINO e DIETA (com histórico) do portal.
--
-- Modelo versionado = histórico: cada plano é uma linha; criar um novo plano
-- DESATIVA o anterior (1 ativo por paciente). O paciente vê o plano ATUAL +
-- os anteriores nas abas Treino/Dieta. Profissional cadastra no prontuário.
--
-- Hierarquia:
--   workout_plans → workout_sessions → workout_exercises
--   diet_plans    → diet_meals       → diet_meal_items
--
-- Append-only: plano só muda `active`/`updated_at` (whitelist). Sessões/itens
-- são imutáveis (pertencem àquela versão). Edição = nova versão.
-- RLS: leitura same-tenant; escrita admin/profissional_saude. Portal lê via
-- service-role escopado pela sessão.

-- ===================== TREINO =====================
CREATE TABLE IF NOT EXISTS public.workout_plans (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  patient_id         UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  title              TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  notes              TEXT NULL CHECK (notes IS NULL OR length(notes) <= 2000),
  active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id UUID NOT NULL REFERENCES auth.users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS workout_plans_one_active
  ON public.workout_plans (tenant_id, patient_id) WHERE active;
CREATE INDEX IF NOT EXISTS workout_plans_patient_idx
  ON public.workout_plans (tenant_id, patient_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.workout_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  plan_id     UUID NOT NULL REFERENCES public.workout_plans(id) ON DELETE CASCADE,
  position    INT NOT NULL DEFAULT 0,
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  focus       TEXT NULL CHECK (focus IS NULL OR length(focus) <= 120),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workout_sessions_plan_idx ON public.workout_sessions (plan_id, position);

CREATE TABLE IF NOT EXISTS public.workout_exercises (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  session_id   UUID NOT NULL REFERENCES public.workout_sessions(id) ON DELETE CASCADE,
  position     INT NOT NULL DEFAULT 0,
  name         TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  sets         INT NULL,
  reps         TEXT NULL CHECK (reps IS NULL OR length(reps) <= 20),
  load_kg      NUMERIC NULL,
  rest_seconds INT NULL,
  notes        TEXT NULL CHECK (notes IS NULL OR length(notes) <= 500),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workout_exercises_session_idx ON public.workout_exercises (session_id, position);

-- ===================== DIETA =====================
CREATE TABLE IF NOT EXISTS public.diet_plans (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  patient_id         UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  title              TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  notes              TEXT NULL CHECK (notes IS NULL OR length(notes) <= 2000),
  active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id UUID NOT NULL REFERENCES auth.users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS diet_plans_one_active
  ON public.diet_plans (tenant_id, patient_id) WHERE active;
CREATE INDEX IF NOT EXISTS diet_plans_patient_idx
  ON public.diet_plans (tenant_id, patient_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.diet_meals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  plan_id     UUID NOT NULL REFERENCES public.diet_plans(id) ON DELETE CASCADE,
  position    INT NOT NULL DEFAULT 0,
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  time_label  TEXT NULL CHECK (time_label IS NULL OR length(time_label) <= 20),
  notes       TEXT NULL CHECK (notes IS NULL OR length(notes) <= 500),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS diet_meals_plan_idx ON public.diet_meals (plan_id, position);

CREATE TABLE IF NOT EXISTS public.diet_meal_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  meal_id     UUID NOT NULL REFERENCES public.diet_meals(id) ON DELETE CASCADE,
  position    INT NOT NULL DEFAULT 0,
  food        TEXT NOT NULL CHECK (length(food) BETWEEN 1 AND 200),
  quantity    TEXT NULL CHECK (quantity IS NULL OR length(quantity) <= 60),
  notes       TEXT NULL CHECK (notes IS NULL OR length(notes) <= 300),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS diet_meal_items_meal_idx ON public.diet_meal_items (meal_id, position);

-- ===================== triggers + RLS =====================
DO $$
DECLARE t TEXT;
BEGIN
  -- touch_updated_at nos planos
  FOR t IN SELECT unnest(ARRAY['workout_plans','diet_plans']) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_touch ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER %I_touch BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()', t, t);
  END LOOP;
END $$;

-- Plano: só active/updated_at mudam (append-only de versão).
DROP TRIGGER IF EXISTS workout_plans_append_only ON public.workout_plans;
CREATE TRIGGER workout_plans_append_only BEFORE UPDATE OR DELETE ON public.workout_plans
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only_columns('active,updated_at');
DROP TRIGGER IF EXISTS diet_plans_append_only ON public.diet_plans;
CREATE TRIGGER diet_plans_append_only BEFORE UPDATE OR DELETE ON public.diet_plans
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only_columns('active,updated_at');

-- RLS: leitura same-tenant; escrita admin/profissional_saude. (Cascade filhos.)
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'workout_plans','workout_sessions','workout_exercises',
    'diet_plans','diet_meals','diet_meal_items'
  ]) LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_read ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_read ON public.%I FOR SELECT TO authenticated USING (tenant_id = public.jwt_tenant_id())', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_write ON public.%I', t, t);
    EXECUTE format($f$CREATE POLICY %I_write ON public.%I FOR ALL TO authenticated USING (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN ('admin','profissional_saude')) WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN ('admin','profissional_saude'))$f$, t, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END $$;

COMMENT ON TABLE public.workout_plans IS 'Feature 032 — plano de treino versionado (1 ativo/paciente; histórico = inativos).';
COMMENT ON TABLE public.diet_plans IS 'Feature 032 — plano alimentar versionado (1 ativo/paciente; histórico = inativos).';

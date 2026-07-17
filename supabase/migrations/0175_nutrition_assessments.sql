-- 0175 — Feature 046: Avaliação Nutricional (composição corporal + gasto energético).
--
-- Tabela append-only `nutrition_assessments`: o retrato imutável de uma
-- avaliação (entradas + método escolhido + resultados calculados). Os
-- derivados (%gordura, massa magra/gorda, IMC, TMB, GET) são lançados no motor
-- de medições (feature 030) pela camada de aplicação (recordMeasurementsBatch).
--
-- Constituição: I (imutável — correção = nova avaliação); II (auditoria via
-- log_audit_event); III (tenant_id + RLS); V (RBAC admin/profissional_saude).
-- Sem dado financeiro/TUSS. Aditiva, idempotente (supabase:reset recria).

-- =========================================================================
-- 1. Tabela nutrition_assessments (append-only)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.nutrition_assessments (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  patient_id             UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  assessed_at            DATE NOT NULL,
  sex                    TEXT NOT NULL CHECK (sex IN ('M', 'F')),
  age_years              INTEGER NOT NULL CHECK (age_years BETWEEN 0 AND 120),
  weight_kg              NUMERIC NOT NULL CHECK (weight_kg BETWEEN 2 AND 400),
  height_cm              NUMERIC NULL CHECK (height_cm IS NULL OR height_cm BETWEEN 30 AND 260),
  skinfolds              JSONB NOT NULL DEFAULT '{}'::jsonb,
  circumferences         JSONB NOT NULL DEFAULT '{}'::jsonb,
  dobra_protocol         TEXT NULL,
  body_density           NUMERIC NULL,
  fat_pct                NUMERIC NULL CHECK (fat_pct IS NULL OR fat_pct BETWEEN 1 AND 75),
  fat_mass_kg            NUMERIC NULL,
  lean_mass_kg           NUMERIC NULL,
  imc                    NUMERIC NULL,
  imc_class              TEXT NULL,
  waist_hip_ratio        NUMERIC NULL,
  waist_hip_class        TEXT NULL,
  tmb_equation           TEXT NULL,
  tmb_kcal               NUMERIC NULL,
  activity_factor        NUMERIC NULL CHECK (activity_factor IS NULL OR activity_factor BETWEEN 1 AND 3),
  injury_factor          NUMERIC NOT NULL DEFAULT 1.0 CHECK (injury_factor BETWEEN 0.5 AND 3),
  extra_kcal             NUMERIC NOT NULL DEFAULT 0,
  get_kcal               NUMERIC NULL,
  objective              TEXT NULL CHECK (objective IS NULL OR objective IN ('deficit', 'manutencao', 'superavit')),
  objective_delta_kcal   NUMERIC NULL,
  target_kcal            NUMERIC NULL,
  target_macros          JSONB NULL,
  notes                  TEXT NULL CHECK (notes IS NULL OR length(notes) <= 2000),
  created_by_user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.nutrition_assessments IS
  'Feature 046 — retrato imutável de uma avaliação nutricional (composição + gasto energético). Correção = nova linha.';

CREATE INDEX IF NOT EXISTS nutrition_assessments_series_idx
  ON public.nutrition_assessments (tenant_id, patient_id, assessed_at DESC);

-- =========================================================================
-- 2. RLS: SELECT por tenant; INSERT admin/profissional_saude do tenant.
-- =========================================================================
ALTER TABLE public.nutrition_assessments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nutrition_assessments_read ON public.nutrition_assessments;
CREATE POLICY nutrition_assessments_read ON public.nutrition_assessments
  FOR SELECT TO authenticated
  USING (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS nutrition_assessments_insert ON public.nutrition_assessments;
CREATE POLICY nutrition_assessments_insert ON public.nutrition_assessments
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() IN ('admin', 'profissional_saude')
  );

REVOKE UPDATE, DELETE ON public.nutrition_assessments FROM authenticated;
GRANT SELECT, INSERT ON public.nutrition_assessments TO authenticated;

-- =========================================================================
-- 3. Append-only (imutável) + auditoria da criação.
-- =========================================================================
DROP TRIGGER IF EXISTS nutrition_assessments_append_only ON public.nutrition_assessments;
CREATE TRIGGER nutrition_assessments_append_only
  BEFORE UPDATE OR DELETE ON public.nutrition_assessments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only();

CREATE OR REPLACE FUNCTION public.audit_nutrition_assessment()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.log_audit_event(
    NEW.tenant_id, 'nutrition_assessments', NEW.id, 'created', NULL,
    json_build_object(
      'patient_id', NEW.patient_id, 'assessed_at', NEW.assessed_at,
      'dobra_protocol', NEW.dobra_protocol, 'tmb_equation', NEW.tmb_equation,
      'fat_pct', NEW.fat_pct, 'get_kcal', NEW.get_kcal
    )::text,
    'feature 046 — avaliação nutricional registrada');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS nutrition_assessments_audit ON public.nutrition_assessments;
CREATE TRIGGER nutrition_assessments_audit
  AFTER INSERT ON public.nutrition_assessments
  FOR EACH ROW EXECUTE FUNCTION public.audit_nutrition_assessment();

-- =========================================================================
-- 4. Métrica nova no catálogo de medições (feature 030): gasto energético total.
--    As demais (peso, imc, percentual_gordura, massa_gorda/magra_kg,
--    taxa_metabolica_basal) já existem (seed de bioimpedância 0174).
-- =========================================================================
INSERT INTO public.patient_metric_types
  (metric_type, label, unit, min_plausible, max_plausible, specialty, display_order)
VALUES
  ('gasto_energetico_total', 'Gasto energético total', 'kcal', 500, 8000, 'nutricao', 11)
ON CONFLICT (metric_type) DO NOTHING;

-- Gotcha 0170: o catalog_baseline restaura os catálogos nos testes. Se ele já
-- existe (DB local com baseline anterior a esta migration), inclui a métrica
-- nova para sobreviver ao reset. Em DB fresco o baseline é capturado depois de
-- todas as migrations e já a inclui.
DO $$ BEGIN
  IF to_regclass('catalog_baseline.patient_metric_types') IS NOT NULL THEN
    INSERT INTO catalog_baseline.patient_metric_types
    SELECT * FROM public.patient_metric_types
    WHERE metric_type = 'gasto_energetico_total'
      AND NOT EXISTS (
        SELECT 1 FROM catalog_baseline.patient_metric_types b
        WHERE b.metric_type = 'gasto_energetico_total'
      );
  END IF;
END $$;

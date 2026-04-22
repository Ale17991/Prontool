-- T-collapse-treatment-plans: remove o nível intermediário "plano de
-- tratamento" — etapas passam a ser filhas diretas do paciente.
--
-- 1. Adiciona treatment_plan_steps.patient_id (nullable temporariamente)
-- 2. Backfill a partir de treatment_plans.patient_id
-- 3. NOT NULL + FK
-- 4. Dropa a coluna treatment_plan_id e a tabela treatment_plans
-- 5. Reconstrói índices/policies que referenciavam treatment_plan_id
--
-- Nome da tabela `treatment_plan_steps` fica como está — entradas em
-- audit_log apontam pra esse entity e renomear fragmentaria o histórico.

ALTER TABLE public.treatment_plan_steps
  ADD COLUMN IF NOT EXISTS patient_id UUID REFERENCES public.patients(id) ON DELETE RESTRICT;

UPDATE public.treatment_plan_steps s
   SET patient_id = p.patient_id
  FROM public.treatment_plans p
 WHERE s.treatment_plan_id = p.id
   AND s.patient_id IS NULL;

ALTER TABLE public.treatment_plan_steps
  ALTER COLUMN patient_id SET NOT NULL;

-- Triggers e policies que dependem da coluna treatment_plan_id (via
-- checagem no enforce_treatment_plan_step_mutability) precisam ser
-- reinstalados sem essa coluna.
DROP TRIGGER IF EXISTS treatment_plan_steps_col_guard ON public.treatment_plan_steps;

CREATE OR REPLACE FUNCTION public.enforce_treatment_plan_step_mutability()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role', 'supabase_auth_admin') THEN
    RETURN NEW;
  END IF;

  IF NEW.id             IS DISTINCT FROM OLD.id
     OR NEW.tenant_id      IS DISTINCT FROM OLD.tenant_id
     OR NEW.patient_id     IS DISTINCT FROM OLD.patient_id
     OR NEW.procedure_id   IS DISTINCT FROM OLD.procedure_id
     OR NEW.plan_id        IS DISTINCT FROM OLD.plan_id
     OR NEW.title          IS DISTINCT FROM OLD.title
     OR NEW.notes          IS DISTINCT FROM OLD.notes
     OR NEW.scheduled_date IS DISTINCT FROM OLD.scheduled_date
     OR NEW.created_by     IS DISTINCT FROM OLD.created_by
     OR NEW.created_at     IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING
      MESSAGE = 'treatment_plan_steps: only status/completed_at/completed_by are mutable',
      ERRCODE = '42501';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER treatment_plan_steps_col_guard
  BEFORE UPDATE ON public.treatment_plan_steps
  FOR EACH ROW EXECUTE FUNCTION public.enforce_treatment_plan_step_mutability();

-- Substitui o índice (tenant, plan, created) — agora por paciente.
DROP INDEX IF EXISTS treatment_plan_steps_plan_idx;
CREATE INDEX IF NOT EXISTS treatment_plan_steps_patient_idx
  ON public.treatment_plan_steps (tenant_id, patient_id, scheduled_date, created_at);

ALTER TABLE public.treatment_plan_steps
  DROP COLUMN IF EXISTS treatment_plan_id;

-- treatment_plans some; audit trigger/policies da tabela caem junto.
DROP TABLE IF EXISTS public.treatment_plans CASCADE;
DROP FUNCTION IF EXISTS public.audit_treatment_plans_change() CASCADE;

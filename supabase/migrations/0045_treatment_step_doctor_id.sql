-- 0045 — Atribuir um profissional responsável (doctor_id) a cada etapa
-- de tratamento. Mantém-se nullable para preservar etapas legadas que
-- foram criadas antes desta coluna (não dá pra inferir o profissional
-- post-hoc). API força o preenchimento em criações novas.
--
-- doctor_id é tratado como dado de criação (imutável após o insert,
-- como title/procedure_id/scheduled_date) — adicionamos ele à lista
-- de colunas protegidas pelo trigger enforce_treatment_plan_step_mutability.

ALTER TABLE public.treatment_plan_steps
  ADD COLUMN IF NOT EXISTS doctor_id UUID REFERENCES public.doctors(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS treatment_plan_steps_doctor_idx
  ON public.treatment_plan_steps (tenant_id, doctor_id);

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
     OR NEW.doctor_id      IS DISTINCT FROM OLD.doctor_id
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

NOTIFY pgrst, 'reload schema';

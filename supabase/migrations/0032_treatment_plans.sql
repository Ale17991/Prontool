-- T-treatment-plans: planos de tratamento e suas etapas.
-- treatment_plans agrupa um conjunto de procedimentos planejados para um
-- paciente. treatment_plan_steps é append-only (apenas status/completed_at/
-- completed_by mudam) — o plano é uma intenção clínica e a etapa materializa
-- uma ordem; alterar título/procedimento depois confundiria auditoria.

-- =========================================================================
-- Tables
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.treatment_plans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  patient_id      UUID NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  title           TEXT NOT NULL CHECK (length(btrim(title)) > 0),
  description     TEXT,
  status          TEXT NOT NULL DEFAULT 'ativo'
                    CHECK (status IN ('ativo', 'concluido', 'cancelado')),
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS treatment_plans_patient_idx
  ON public.treatment_plans (tenant_id, patient_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.treatment_plan_steps (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  treatment_plan_id   UUID NOT NULL REFERENCES public.treatment_plans(id) ON DELETE RESTRICT,
  procedure_id        UUID NOT NULL REFERENCES public.procedures(id) ON DELETE RESTRICT,
  plan_id             UUID REFERENCES public.health_plans(id) ON DELETE RESTRICT,
  title               TEXT NOT NULL CHECK (length(btrim(title)) > 0),
  notes               TEXT,
  scheduled_date      DATE,
  status              TEXT NOT NULL DEFAULT 'pendente'
                        CHECK (status IN ('pendente', 'concluido', 'cancelado')),
  completed_at        TIMESTAMPTZ,
  completed_by        UUID,
  created_by          UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Quando status = concluido, completed_at obrigatório.
  CONSTRAINT treatment_plan_steps_completion_consistent CHECK (
    (status = 'concluido' AND completed_at IS NOT NULL)
    OR (status <> 'concluido' AND completed_at IS NULL AND completed_by IS NULL)
    OR (status = 'cancelado')
  )
);

CREATE INDEX IF NOT EXISTS treatment_plan_steps_plan_idx
  ON public.treatment_plan_steps (tenant_id, treatment_plan_id, created_at);
CREATE INDEX IF NOT EXISTS treatment_plan_steps_procedure_idx
  ON public.treatment_plan_steps (tenant_id, procedure_id);
CREATE INDEX IF NOT EXISTS treatment_plan_steps_status_idx
  ON public.treatment_plan_steps (tenant_id, status)
  WHERE status = 'pendente';

-- =========================================================================
-- Column-scoped immutability on treatment_plan_steps
-- Only status, completed_at, completed_by são mutáveis. DELETE bloqueado.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.enforce_treatment_plan_step_mutability()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role', 'supabase_auth_admin') THEN
    RETURN NEW;
  END IF;

  IF NEW.id                IS DISTINCT FROM OLD.id
     OR NEW.tenant_id         IS DISTINCT FROM OLD.tenant_id
     OR NEW.treatment_plan_id IS DISTINCT FROM OLD.treatment_plan_id
     OR NEW.procedure_id      IS DISTINCT FROM OLD.procedure_id
     OR NEW.plan_id           IS DISTINCT FROM OLD.plan_id
     OR NEW.title             IS DISTINCT FROM OLD.title
     OR NEW.notes             IS DISTINCT FROM OLD.notes
     OR NEW.scheduled_date    IS DISTINCT FROM OLD.scheduled_date
     OR NEW.created_by        IS DISTINCT FROM OLD.created_by
     OR NEW.created_at        IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING
      MESSAGE = 'treatment_plan_steps: only status/completed_at/completed_by are mutable',
      ERRCODE = '42501';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS treatment_plan_steps_col_guard ON public.treatment_plan_steps;
CREATE TRIGGER treatment_plan_steps_col_guard
  BEFORE UPDATE ON public.treatment_plan_steps
  FOR EACH ROW EXECUTE FUNCTION public.enforce_treatment_plan_step_mutability();

DROP TRIGGER IF EXISTS treatment_plan_steps_no_delete ON public.treatment_plan_steps;
CREATE TRIGGER treatment_plan_steps_no_delete
  BEFORE DELETE ON public.treatment_plan_steps
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only();

-- =========================================================================
-- Audit triggers
-- =========================================================================

CREATE OR REPLACE FUNCTION public.audit_treatment_plans_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'treatment_plans', NEW.id,
      NULL, NULL, NEW.title, 'created'
    );
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'treatment_plans', NEW.id,
      'status', OLD.status, NEW.status, 'status-change'
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS treatment_plans_audit ON public.treatment_plans;
CREATE TRIGGER treatment_plans_audit
  AFTER INSERT OR UPDATE ON public.treatment_plans
  FOR EACH ROW EXECUTE FUNCTION public.audit_treatment_plans_change();

CREATE OR REPLACE FUNCTION public.audit_treatment_plan_steps_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'treatment_plan_steps', NEW.id,
      NULL, NULL, NEW.title, 'created'
    );
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'treatment_plan_steps', NEW.id,
      'status', OLD.status, NEW.status, 'status-change'
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS treatment_plan_steps_audit ON public.treatment_plan_steps;
CREATE TRIGGER treatment_plan_steps_audit
  AFTER INSERT OR UPDATE ON public.treatment_plan_steps
  FOR EACH ROW EXECUTE FUNCTION public.audit_treatment_plan_steps_change();

-- =========================================================================
-- RLS
-- =========================================================================

ALTER TABLE public.treatment_plans       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treatment_plan_steps  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS treatment_plans_read ON public.treatment_plans;
CREATE POLICY treatment_plans_read ON public.treatment_plans
  FOR SELECT USING (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() IN ('admin', 'financeiro', 'recepcionista', 'profissional_saude')
  );

DROP POLICY IF EXISTS treatment_plans_write_insert ON public.treatment_plans;
CREATE POLICY treatment_plans_write_insert ON public.treatment_plans
  FOR INSERT WITH CHECK (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() IN ('admin', 'financeiro', 'profissional_saude')
  );

DROP POLICY IF EXISTS treatment_plans_write_update ON public.treatment_plans;
CREATE POLICY treatment_plans_write_update ON public.treatment_plans
  FOR UPDATE USING (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() IN ('admin', 'financeiro', 'profissional_saude')
  );

DROP POLICY IF EXISTS treatment_plan_steps_read ON public.treatment_plan_steps;
CREATE POLICY treatment_plan_steps_read ON public.treatment_plan_steps
  FOR SELECT USING (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() IN ('admin', 'financeiro', 'recepcionista', 'profissional_saude')
  );

DROP POLICY IF EXISTS treatment_plan_steps_write_insert ON public.treatment_plan_steps;
CREATE POLICY treatment_plan_steps_write_insert ON public.treatment_plan_steps
  FOR INSERT WITH CHECK (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() IN ('admin', 'financeiro', 'profissional_saude')
  );

DROP POLICY IF EXISTS treatment_plan_steps_write_update ON public.treatment_plan_steps;
CREATE POLICY treatment_plan_steps_write_update ON public.treatment_plan_steps
  FOR UPDATE USING (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() IN ('admin', 'financeiro', 'profissional_saude')
  );

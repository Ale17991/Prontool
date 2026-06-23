-- 0160 — Feature 040: Plano de tratamento odontológico + Orçamento (Fase 2).
-- (Reaproveita a 0138 da branch 040-plano-tratamento-odonto, renumerada para
--  0160 — próximo número livre na master — e com a função de mutabilidade
--  RECONCILIADA com a versão vigente (0056, que inclui doctor_id). Aplicar a
--  0138 original FARIA REGRESSÃO de enforce_treatment_plan_step_mutability.)
--
-- Estende treatment_plan_steps com POSIÇÃO DENTÁRIA (tooth_fdi/surface) e
-- vínculo a ORÇAMENTO (budget_id). Cria treatment_budgets (proposta com ciclo
-- proposto→apresentado→aceito/recusado e total congelado).
--
-- Constituição:
--   I  — steps já column-guarded; tooth_fdi/surface entram como imutáveis;
--        orçamento aceito/recusado é terminal; total congelado no aceite.
--   II — auditoria de treatment_budgets via log_audit_event; steps já auditados.
--   III— tenant_id + RLS + consistência step↔budget (tenant/paciente).
--   IV — itens usam procedures (TUSS 22) + precificação existente.
--   V  — escrita restrita a admin/financeiro/profissional_saude.
--
-- Aditiva e idempotente.

-- =========================================================================
-- 1. treatment_budgets — orçamento/proposta
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.treatment_budgets (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  patient_id         UUID NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  title              TEXT NULL CHECK (title IS NULL OR length(btrim(title)) BETWEEN 1 AND 120),
  status             TEXT NOT NULL DEFAULT 'proposto'
                       CHECK (status IN ('proposto', 'apresentado', 'aceito', 'recusado')),
  frozen_total_cents INTEGER NULL CHECK (frozen_total_cents IS NULL OR frozen_total_cents >= 0),
  presented_at       TIMESTAMPTZ NULL,
  accepted_at        TIMESTAMPTZ NULL,
  refused_at         TIMESTAMPTZ NULL,
  created_by         UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.treatment_budgets IS
  'Feature 040 — Orçamento odontológico (proposta). Agrupa treatment_plan_steps via steps.budget_id. aceito/recusado terminais; frozen_total_cents = snapshot no aceite.';

CREATE INDEX IF NOT EXISTS treatment_budgets_patient_idx
  ON public.treatment_budgets (tenant_id, patient_id, status, created_at DESC);

-- Ciclo de status + imutabilidade do núcleo (BEFORE UPDATE).
CREATE OR REPLACE FUNCTION public.enforce_treatment_budget_update()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Núcleo imutável.
  IF NEW.id         IS DISTINCT FROM OLD.id
     OR NEW.tenant_id  IS DISTINCT FROM OLD.tenant_id
     OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING
      MESSAGE = 'treatment_budgets: campos de núcleo são imutáveis', ERRCODE = '42501';
  END IF;

  -- frozen_total_cents é settable-once (NULL → valor; nunca muda depois).
  IF OLD.frozen_total_cents IS NOT NULL
     AND NEW.frozen_total_cents IS DISTINCT FROM OLD.frozen_total_cents THEN
    RAISE EXCEPTION USING
      MESSAGE = 'treatment_budgets: total congelado é imutável', ERRCODE = '42501';
  END IF;

  -- Transições de status.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status IN ('aceito', 'recusado') THEN
      RAISE EXCEPTION USING
        MESSAGE = format('treatment_budgets: status %s é terminal (orçamento imutável)', OLD.status),
        ERRCODE = '42501';
    END IF;
    IF NOT (
      (OLD.status = 'proposto'    AND NEW.status IN ('apresentado', 'aceito', 'recusado'))
      OR (OLD.status = 'apresentado' AND NEW.status IN ('aceito', 'recusado'))
    ) THEN
      RAISE EXCEPTION USING
        MESSAGE = format('treatment_budgets: transição %s → %s inválida', OLD.status, NEW.status),
        ERRCODE = '42501';
    END IF;
    IF NEW.status = 'aceito' AND (NEW.frozen_total_cents IS NULL OR NEW.accepted_at IS NULL) THEN
      RAISE EXCEPTION USING
        MESSAGE = 'treatment_budgets: aceite exige frozen_total_cents e accepted_at', ERRCODE = '42501';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS treatment_budgets_update_guard ON public.treatment_budgets;
CREATE TRIGGER treatment_budgets_update_guard
  BEFORE UPDATE ON public.treatment_budgets
  FOR EACH ROW EXECUTE FUNCTION public.enforce_treatment_budget_update();

DROP TRIGGER IF EXISTS treatment_budgets_no_delete ON public.treatment_budgets;
CREATE TRIGGER treatment_budgets_no_delete
  BEFORE DELETE ON public.treatment_budgets
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only();

-- Auditoria (created + transições de status).
CREATE OR REPLACE FUNCTION public.audit_treatment_budget_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'treatment_budgets', NEW.id, NULL, NULL,
      COALESCE(NEW.title, NEW.status), 'created');
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'treatment_budgets', NEW.id, 'status',
      OLD.status, NEW.status, 'status-change');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS treatment_budgets_audit ON public.treatment_budgets;
CREATE TRIGGER treatment_budgets_audit
  AFTER INSERT OR UPDATE ON public.treatment_budgets
  FOR EACH ROW EXECUTE FUNCTION public.audit_treatment_budget_change();

-- RLS (espelha treatment_plans).
ALTER TABLE public.treatment_budgets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS treatment_budgets_read ON public.treatment_budgets;
CREATE POLICY treatment_budgets_read ON public.treatment_budgets
  FOR SELECT USING (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() IN ('admin', 'financeiro', 'recepcionista', 'profissional_saude')
  );

DROP POLICY IF EXISTS treatment_budgets_insert ON public.treatment_budgets;
CREATE POLICY treatment_budgets_insert ON public.treatment_budgets
  FOR INSERT WITH CHECK (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() IN ('admin', 'financeiro', 'profissional_saude')
  );

DROP POLICY IF EXISTS treatment_budgets_update ON public.treatment_budgets;
CREATE POLICY treatment_budgets_update ON public.treatment_budgets
  FOR UPDATE USING (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() IN ('admin', 'financeiro', 'profissional_saude')
  );

GRANT SELECT, INSERT, UPDATE ON public.treatment_budgets TO authenticated;

-- =========================================================================
-- 2. ALTER treatment_plan_steps — posição dentária + vínculo a orçamento
-- =========================================================================

ALTER TABLE public.treatment_plan_steps
  ADD COLUMN IF NOT EXISTS tooth_fdi SMALLINT NULL,
  ADD COLUMN IF NOT EXISTS surface   TEXT NULL,
  ADD COLUMN IF NOT EXISTS budget_id UUID NULL;

DO $$ BEGIN
  ALTER TABLE public.treatment_plan_steps
    ADD CONSTRAINT treatment_plan_steps_tooth_fdi_chk CHECK (
      tooth_fdi IS NULL OR (
        (tooth_fdi BETWEEN 11 AND 18) OR (tooth_fdi BETWEEN 21 AND 28) OR
        (tooth_fdi BETWEEN 31 AND 38) OR (tooth_fdi BETWEEN 41 AND 48) OR
        (tooth_fdi BETWEEN 51 AND 55) OR (tooth_fdi BETWEEN 61 AND 65) OR
        (tooth_fdi BETWEEN 71 AND 75) OR (tooth_fdi BETWEEN 81 AND 85)
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- surface inclui cervical/raiz (alinhado à 0159 do odontograma).
DO $$ BEGIN
  ALTER TABLE public.treatment_plan_steps
    ADD CONSTRAINT treatment_plan_steps_surface_chk CHECK (
      surface IS NULL OR
      surface IN ('mesial', 'distal', 'occlusal_incisal', 'vestibular', 'lingual_palatal', 'cervical', 'raiz')
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.treatment_plan_steps
    ADD CONSTRAINT treatment_plan_steps_budget_fk
    FOREIGN KEY (budget_id) REFERENCES public.treatment_budgets(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS treatment_plan_steps_budget_idx
  ON public.treatment_plan_steps (tenant_id, budget_id);

-- Column-guard RECONCILIADO com a versão vigente (0056): preserva doctor_id e
-- appointment_id (one-shot) no whitelist de imutabilidade e ACRESCENTA
-- tooth_fdi/surface como IMUTÁVEIS. budget_id fica FORA do guard (mutável) —
-- regras específicas no trigger dental abaixo.
CREATE OR REPLACE FUNCTION public.enforce_treatment_plan_step_mutability()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role', 'supabase_auth_admin') THEN
    RETURN NEW;
  END IF;

  -- appointment_id: one-shot link (só permite UPDATE quando OLD é NULL).
  IF NEW.appointment_id IS DISTINCT FROM OLD.appointment_id THEN
    IF OLD.appointment_id IS NOT NULL THEN
      RAISE EXCEPTION USING
        MESSAGE = 'treatment_plan_steps.appointment_id is immutable once set',
        ERRCODE = '42501';
    END IF;
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
     OR NEW.tooth_fdi      IS DISTINCT FROM OLD.tooth_fdi
     OR NEW.surface        IS DISTINCT FROM OLD.surface
     OR NEW.created_by     IS DISTINCT FROM OLD.created_by
     OR NEW.created_at     IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING
      MESSAGE = 'treatment_plan_steps: only status/completed_at/completed_by/appointment_id (one-shot)/budget_id are mutable',
      ERRCODE = '42501';
  END IF;

  RETURN NEW;
END $$;

-- Regras dentais (aplicam a TODOS os papéis, inclusive service_role, pois o
-- app escreve via service client): gating de execução + imutabilidade do
-- orçamento aceito + consistência step↔budget. Escopo: itens dentais
-- (tooth_fdi NOT NULL) ou quando há budget_id, para não afetar etapas legadas.
CREATE OR REPLACE FUNCTION public.enforce_dental_plan_step_rules()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_b_tenant  UUID;
  v_b_patient UUID;
  v_b_status  TEXT;
  v_old_status TEXT;
BEGIN
  -- Consistência ao (re)linkar budget_id.
  IF NEW.budget_id IS NOT NULL THEN
    SELECT tenant_id, patient_id, status
      INTO v_b_tenant, v_b_patient, v_b_status
      FROM public.treatment_budgets WHERE id = NEW.budget_id;
    IF v_b_tenant IS NULL THEN
      RAISE EXCEPTION 'budget % inexistente', NEW.budget_id USING ERRCODE = '23503';
    END IF;
    IF v_b_tenant <> NEW.tenant_id OR v_b_patient <> NEW.patient_id THEN
      RAISE EXCEPTION 'DENTAL_BUDGET_MISMATCH: orçamento de outro tenant/paciente' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Não religa itens de/para orçamento aceito (orçamento aceito é imutável).
    IF NEW.budget_id IS DISTINCT FROM OLD.budget_id THEN
      IF OLD.budget_id IS NOT NULL THEN
        SELECT status INTO v_old_status FROM public.treatment_budgets WHERE id = OLD.budget_id;
        IF v_old_status = 'aceito' THEN
          RAISE EXCEPTION 'orçamento aceito é imutável: não remove itens' USING ERRCODE = '42501';
        END IF;
      END IF;
      IF NEW.budget_id IS NOT NULL AND v_b_status = 'aceito' THEN
        RAISE EXCEPTION 'não é possível adicionar itens a um orçamento aceito' USING ERRCODE = '42501';
      END IF;
    END IF;

    -- Gating de execução para itens dentais: concluir exige orçamento aceito.
    IF NEW.tooth_fdi IS NOT NULL
       AND NEW.status = 'concluido' AND OLD.status IS DISTINCT FROM 'concluido' THEN
      IF NEW.budget_id IS NULL OR v_b_status IS DISTINCT FROM 'aceito' THEN
        RAISE EXCEPTION 'DENTAL_PLAN_NOT_AUTHORIZED: execução exige orçamento aceito' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS treatment_plan_steps_dental_rules ON public.treatment_plan_steps;
CREATE TRIGGER treatment_plan_steps_dental_rules
  BEFORE INSERT OR UPDATE ON public.treatment_plan_steps
  FOR EACH ROW EXECUTE FUNCTION public.enforce_dental_plan_step_rules();

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- Done.
-- =========================================================================

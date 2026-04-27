-- 0047 — Soft-disable de modelos de anamnese + soft-delete de etapas
-- de plano de tratamento.
--
-- 1. anamnesis_templates ganha `active` (default TRUE). Modelos podem ser
--    desativados/reativados sem deletar a linha (anamneses já preenchidas
--    continuam apontando pra versão original via snapshot em
--    clinical_records.anamnesis_data). O trigger de imutabilidade passa a
--    permitir UPDATE somente da coluna active.
-- 2. treatment_plan_steps ganha `deleted_at`. O trigger column-guard inclui
--    deleted_at na lista de campos mutáveis. Atestado de auditoria registra
--    soft-deletes.

-- ============================================================================
-- Anamnesis templates: active flag
-- ============================================================================
ALTER TABLE public.anamnesis_templates
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS anamnesis_templates_active_idx
  ON public.anamnesis_templates (tenant_id, active);

CREATE OR REPLACE FUNCTION public.enforce_anamnesis_templates_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role') THEN RETURN NEW; END IF;

  IF NEW.id                  IS DISTINCT FROM OLD.id
     OR NEW.tenant_id        IS DISTINCT FROM OLD.tenant_id
     OR NEW.title            IS DISTINCT FROM OLD.title
     OR NEW.description      IS DISTINCT FROM OLD.description
     OR NEW.version          IS DISTINCT FROM OLD.version
     OR NEW.previous_version_id IS DISTINCT FROM OLD.previous_version_id
     OR NEW.fields           IS DISTINCT FROM OLD.fields
     OR NEW.created_by       IS DISTINCT FROM OLD.created_by
     OR NEW.created_at       IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'anamnesis_templates: only `active` is mutable. Create a new version to change content.';
  END IF;
  RETURN NEW;
END $$;

DROP POLICY IF EXISTS anamnesis_templates_admin_update ON public.anamnesis_templates;
CREATE POLICY anamnesis_templates_admin_update ON public.anamnesis_templates FOR UPDATE
  USING (
    tenant_id = public.jwt_tenant_id() AND
    public.jwt_role() = 'admin'
  )
  WITH CHECK (
    tenant_id = public.jwt_tenant_id() AND
    public.jwt_role() = 'admin'
  );

GRANT UPDATE (active) ON public.anamnesis_templates TO authenticated;

-- Audit hook pra mudanças de active (sem PII na trilha — só boolean).
CREATE OR REPLACE FUNCTION public.audit_anamnesis_templates_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'anamnesis_templates', NEW.id,
      'active', NULL, NEW.active::text, 'template-created'
    );
  ELSIF TG_OP = 'UPDATE' AND NEW.active IS DISTINCT FROM OLD.active THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'anamnesis_templates', NEW.id,
      'active', OLD.active::text, NEW.active::text,
      CASE WHEN NEW.active THEN 'template-reactivated' ELSE 'template-deactivated' END
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS anamnesis_templates_audit ON public.anamnesis_templates;
CREATE TRIGGER anamnesis_templates_audit
  AFTER INSERT OR UPDATE ON public.anamnesis_templates
  FOR EACH ROW EXECUTE FUNCTION public.audit_anamnesis_templates_change();

-- ============================================================================
-- Treatment plan steps: deleted_at (soft delete)
-- ============================================================================
ALTER TABLE public.treatment_plan_steps
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS treatment_plan_steps_alive_idx
  ON public.treatment_plan_steps (tenant_id, patient_id, scheduled_date)
  WHERE deleted_at IS NULL;

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
      MESSAGE = 'treatment_plan_steps: only status/completed_at/completed_by/deleted_at are mutable',
      ERRCODE = '42501';
  END IF;

  RETURN NEW;
END $$;

GRANT UPDATE (deleted_at) ON public.treatment_plan_steps TO authenticated;

CREATE OR REPLACE FUNCTION public.audit_treatment_plan_steps_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'treatment_plan_steps', NEW.id,
      NULL, NULL, NEW.title, 'created'
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      PERFORM public.log_audit_event(
        NEW.tenant_id, 'treatment_plan_steps', NEW.id,
        'status', OLD.status, NEW.status, 'status-change'
      );
    END IF;
    IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
      PERFORM public.log_audit_event(
        NEW.tenant_id, 'treatment_plan_steps', NEW.id,
        'deleted_at',
        COALESCE(OLD.deleted_at::text, 'NULL'),
        COALESCE(NEW.deleted_at::text, 'NULL'),
        'step-soft-deleted'
      );
    END IF;
  END IF;
  RETURN NEW;
END $$;

NOTIFY pgrst, 'reload schema';

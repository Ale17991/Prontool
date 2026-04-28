-- 0060 — Diagnósticos do paciente (CID-10).
--
-- Tabela append-only com soft-delete via deleted_at. Diferente de
-- patient_allergies (0051): status é mutável (ativo / em_acompanhamento
-- / resolvido), refletindo a natureza evolutiva do diagnóstico clínico.
-- Demais colunas são imutáveis. Audit trigger registra criação, mudança
-- de status e soft-delete.

CREATE TABLE IF NOT EXISTS public.patient_diagnoses (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  patient_id          UUID NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  cid10_code          TEXT NOT NULL CHECK (char_length(cid10_code) BETWEEN 1 AND 20),
  cid10_description   TEXT NOT NULL CHECK (char_length(cid10_description) BETWEEN 1 AND 500),
  additional_notes    TEXT CHECK (additional_notes IS NULL OR char_length(additional_notes) <= 2000),
  diagnosed_at        DATE NOT NULL DEFAULT current_date,
  status              TEXT NOT NULL DEFAULT 'ativo'
                          CHECK (status IN ('ativo', 'em_acompanhamento', 'resolvido')),
  diagnosed_by        UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS patient_diagnoses_patient_idx
  ON public.patient_diagnoses (tenant_id, patient_id, diagnosed_at DESC);
CREATE INDEX IF NOT EXISTS patient_diagnoses_alive_idx
  ON public.patient_diagnoses (tenant_id, patient_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS patient_diagnoses_code_idx
  ON public.patient_diagnoses (tenant_id, cid10_code)
  WHERE deleted_at IS NULL;

-- Mutabilidade: somente status e deleted_at podem mudar.
CREATE OR REPLACE FUNCTION public.enforce_patient_diagnoses_mutability()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role') THEN RETURN NEW; END IF;
  IF NEW.id                  IS DISTINCT FROM OLD.id
     OR NEW.tenant_id           IS DISTINCT FROM OLD.tenant_id
     OR NEW.patient_id          IS DISTINCT FROM OLD.patient_id
     OR NEW.cid10_code          IS DISTINCT FROM OLD.cid10_code
     OR NEW.cid10_description   IS DISTINCT FROM OLD.cid10_description
     OR NEW.additional_notes    IS DISTINCT FROM OLD.additional_notes
     OR NEW.diagnosed_at        IS DISTINCT FROM OLD.diagnosed_at
     OR NEW.diagnosed_by        IS DISTINCT FROM OLD.diagnosed_by
     OR NEW.created_at          IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'patient_diagnoses: only status and deleted_at are mutable';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS patient_diagnoses_immutable_columns ON public.patient_diagnoses;
CREATE TRIGGER patient_diagnoses_immutable_columns
  BEFORE UPDATE ON public.patient_diagnoses
  FOR EACH ROW EXECUTE FUNCTION public.enforce_patient_diagnoses_mutability();

DROP TRIGGER IF EXISTS patient_diagnoses_no_delete ON public.patient_diagnoses;
CREATE TRIGGER patient_diagnoses_no_delete
  BEFORE DELETE ON public.patient_diagnoses
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only();

-- Auditoria: log de criação, mudança de status e soft-delete.
CREATE OR REPLACE FUNCTION public.audit_patient_diagnoses_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'patient_diagnoses', NEW.id,
      'cid10_code', NULL, NEW.cid10_code, 'diagnosis-recorded'
    );
  ELSIF TG_OP = 'UPDATE' AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'patient_diagnoses', NEW.id,
      'deleted_at',
      COALESCE(OLD.deleted_at::text, 'NULL'),
      COALESCE(NEW.deleted_at::text, 'NULL'),
      'diagnosis-soft-deleted'
    );
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'patient_diagnoses', NEW.id,
      'status', OLD.status, NEW.status, 'diagnosis-status-changed'
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS patient_diagnoses_audit ON public.patient_diagnoses;
CREATE TRIGGER patient_diagnoses_audit
  AFTER INSERT OR UPDATE ON public.patient_diagnoses
  FOR EACH ROW EXECUTE FUNCTION public.audit_patient_diagnoses_change();

-- RLS.
ALTER TABLE public.patient_diagnoses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS patient_diagnoses_read ON public.patient_diagnoses;
CREATE POLICY patient_diagnoses_read ON public.patient_diagnoses FOR SELECT
  USING (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS patient_diagnoses_write_insert ON public.patient_diagnoses;
CREATE POLICY patient_diagnoses_write_insert ON public.patient_diagnoses FOR INSERT
  WITH CHECK (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() IN ('admin', 'profissional_saude')
  );

DROP POLICY IF EXISTS patient_diagnoses_write_update ON public.patient_diagnoses;
CREATE POLICY patient_diagnoses_write_update ON public.patient_diagnoses FOR UPDATE
  USING (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() IN ('admin', 'profissional_saude')
  );

GRANT SELECT, INSERT ON public.patient_diagnoses TO authenticated;
GRANT UPDATE (status, deleted_at) ON public.patient_diagnoses TO authenticated;

NOTIFY pgrst, 'reload schema';

-- 0051 — Alergias e antecedentes do paciente.
--
-- Append-only com soft-delete via deleted_at. Texto em plaintext (dado
-- clínico, não PII de identificação). Audit trigger registra criação e
-- soft-delete pra preservar trilha.

-- ============================================================================
-- patient_allergies
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.patient_allergies (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  patient_id   UUID NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  substance    TEXT NOT NULL CHECK (char_length(substance) BETWEEN 1 AND 200),
  severity     TEXT NOT NULL DEFAULT 'moderada' CHECK (severity IN ('leve', 'moderada', 'grave')),
  notes        TEXT,
  reported_by  UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reported_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS patient_allergies_patient_idx
  ON public.patient_allergies (tenant_id, patient_id, reported_at DESC);
CREATE INDEX IF NOT EXISTS patient_allergies_alive_idx
  ON public.patient_allergies (tenant_id, patient_id)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.enforce_patient_allergies_mutability()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role') THEN RETURN NEW; END IF;
  IF NEW.id          IS DISTINCT FROM OLD.id
     OR NEW.tenant_id   IS DISTINCT FROM OLD.tenant_id
     OR NEW.patient_id  IS DISTINCT FROM OLD.patient_id
     OR NEW.substance   IS DISTINCT FROM OLD.substance
     OR NEW.severity    IS DISTINCT FROM OLD.severity
     OR NEW.notes       IS DISTINCT FROM OLD.notes
     OR NEW.reported_by IS DISTINCT FROM OLD.reported_by
     OR NEW.reported_at IS DISTINCT FROM OLD.reported_at THEN
    RAISE EXCEPTION 'patient_allergies: only deleted_at is mutable';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS patient_allergies_immutable_columns ON public.patient_allergies;
CREATE TRIGGER patient_allergies_immutable_columns
  BEFORE UPDATE ON public.patient_allergies
  FOR EACH ROW EXECUTE FUNCTION public.enforce_patient_allergies_mutability();

DROP TRIGGER IF EXISTS patient_allergies_no_delete ON public.patient_allergies;
CREATE TRIGGER patient_allergies_no_delete
  BEFORE DELETE ON public.patient_allergies
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only();

CREATE OR REPLACE FUNCTION public.audit_patient_allergies_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'patient_allergies', NEW.id,
      'severity', NULL, NEW.severity, 'allergy-recorded'
    );
  ELSIF TG_OP = 'UPDATE' AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'patient_allergies', NEW.id,
      'deleted_at',
      COALESCE(OLD.deleted_at::text, 'NULL'),
      COALESCE(NEW.deleted_at::text, 'NULL'),
      'allergy-soft-deleted'
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS patient_allergies_audit ON public.patient_allergies;
CREATE TRIGGER patient_allergies_audit
  AFTER INSERT OR UPDATE ON public.patient_allergies
  FOR EACH ROW EXECUTE FUNCTION public.audit_patient_allergies_change();

ALTER TABLE public.patient_allergies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS patient_allergies_read ON public.patient_allergies;
CREATE POLICY patient_allergies_read ON public.patient_allergies FOR SELECT
  USING (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS patient_allergies_write_insert ON public.patient_allergies;
CREATE POLICY patient_allergies_write_insert ON public.patient_allergies FOR INSERT
  WITH CHECK (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() IN ('admin', 'financeiro', 'profissional_saude')
  );

DROP POLICY IF EXISTS patient_allergies_write_update ON public.patient_allergies;
CREATE POLICY patient_allergies_write_update ON public.patient_allergies FOR UPDATE
  USING (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() IN ('admin', 'profissional_saude')
  );

GRANT SELECT, INSERT ON public.patient_allergies TO authenticated;
GRANT UPDATE (deleted_at) ON public.patient_allergies TO authenticated;

-- ============================================================================
-- patient_history (antecedentes)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.patient_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  patient_id    UUID NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  category      TEXT NOT NULL CHECK (
    category IN ('doenca_pregressa', 'cirurgia', 'medicamento_uso_continuo',
                 'antecedente_familiar', 'habito', 'outro')
  ),
  description   TEXT NOT NULL CHECK (char_length(description) BETWEEN 1 AND 1000),
  date_reported DATE,
  notes         TEXT,
  reported_by   UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS patient_history_patient_idx
  ON public.patient_history (tenant_id, patient_id, category, created_at DESC);
CREATE INDEX IF NOT EXISTS patient_history_alive_idx
  ON public.patient_history (tenant_id, patient_id)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.enforce_patient_history_mutability()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role') THEN RETURN NEW; END IF;
  IF NEW.id            IS DISTINCT FROM OLD.id
     OR NEW.tenant_id     IS DISTINCT FROM OLD.tenant_id
     OR NEW.patient_id    IS DISTINCT FROM OLD.patient_id
     OR NEW.category      IS DISTINCT FROM OLD.category
     OR NEW.description   IS DISTINCT FROM OLD.description
     OR NEW.date_reported IS DISTINCT FROM OLD.date_reported
     OR NEW.notes         IS DISTINCT FROM OLD.notes
     OR NEW.reported_by   IS DISTINCT FROM OLD.reported_by
     OR NEW.created_at    IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'patient_history: only deleted_at is mutable';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS patient_history_immutable_columns ON public.patient_history;
CREATE TRIGGER patient_history_immutable_columns
  BEFORE UPDATE ON public.patient_history
  FOR EACH ROW EXECUTE FUNCTION public.enforce_patient_history_mutability();

DROP TRIGGER IF EXISTS patient_history_no_delete ON public.patient_history;
CREATE TRIGGER patient_history_no_delete
  BEFORE DELETE ON public.patient_history
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only();

CREATE OR REPLACE FUNCTION public.audit_patient_history_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'patient_history', NEW.id,
      'category', NULL, NEW.category, 'history-recorded'
    );
  ELSIF TG_OP = 'UPDATE' AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'patient_history', NEW.id,
      'deleted_at',
      COALESCE(OLD.deleted_at::text, 'NULL'),
      COALESCE(NEW.deleted_at::text, 'NULL'),
      'history-soft-deleted'
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS patient_history_audit ON public.patient_history;
CREATE TRIGGER patient_history_audit
  AFTER INSERT OR UPDATE ON public.patient_history
  FOR EACH ROW EXECUTE FUNCTION public.audit_patient_history_change();

ALTER TABLE public.patient_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS patient_history_read ON public.patient_history;
CREATE POLICY patient_history_read ON public.patient_history FOR SELECT
  USING (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS patient_history_write_insert ON public.patient_history;
CREATE POLICY patient_history_write_insert ON public.patient_history FOR INSERT
  WITH CHECK (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() IN ('admin', 'financeiro', 'profissional_saude')
  );

DROP POLICY IF EXISTS patient_history_write_update ON public.patient_history;
CREATE POLICY patient_history_write_update ON public.patient_history FOR UPDATE
  USING (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() IN ('admin', 'profissional_saude')
  );

GRANT SELECT, INSERT ON public.patient_history TO authenticated;
GRANT UPDATE (deleted_at) ON public.patient_history TO authenticated;

NOTIFY pgrst, 'reload schema';

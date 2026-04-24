-- Prontuário do paciente: registros clínicos (texto ou anexo de arquivo).
-- Append-only com soft-delete via `deleted_at` (nunca DELETE físico).
-- Anonymização LGPD pode atualizar `content`, `file_name`, `file_url`,
-- `file_size_bytes` para placeholders — somente via service-role.

CREATE TABLE IF NOT EXISTS public.clinical_records (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  patient_id      UUID NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  title           TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  type            TEXT NOT NULL CHECK (type IN ('texto', 'arquivo')),
  content         TEXT,
  file_name       TEXT,
  file_size_bytes BIGINT CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0),
  file_url        TEXT,
  created_by      UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  CHECK (
    (type = 'texto'   AND content IS NOT NULL AND file_url IS NULL AND file_name IS NULL)
    OR
    (type = 'arquivo' AND file_url IS NOT NULL AND file_name IS NOT NULL AND content IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS clinical_records_patient_idx
  ON public.clinical_records (tenant_id, patient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS clinical_records_alive_idx
  ON public.clinical_records (tenant_id, patient_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Append-only / column-level immutability
--
-- O fluxo padrão (usuário admin/financeiro via API) sempre passa pelo
-- service-role client, então o trigger é exempto. Esta proteção existe pra
-- bloquear acesso direto ao banco como `authenticated`. Apenas `deleted_at`,
-- `content`, `file_name`, `file_url` e `file_size_bytes` podem ser
-- atualizados — os dois últimos blocos servem ao soft-delete e à
-- anonymização LGPD.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_clinical_records_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role') THEN
    RETURN NEW;
  END IF;

  IF NEW.id          IS DISTINCT FROM OLD.id
     OR NEW.tenant_id  IS DISTINCT FROM OLD.tenant_id
     OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
     OR NEW.title      IS DISTINCT FROM OLD.title
     OR NEW.type       IS DISTINCT FROM OLD.type
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'clinical_records: only deleted_at and anonymization fields are mutable';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS clinical_records_immutable_columns ON public.clinical_records;
CREATE TRIGGER clinical_records_immutable_columns
  BEFORE UPDATE ON public.clinical_records
  FOR EACH ROW EXECUTE FUNCTION public.enforce_clinical_records_mutation();

DROP TRIGGER IF EXISTS clinical_records_no_delete ON public.clinical_records;
CREATE TRIGGER clinical_records_no_delete
  BEFORE DELETE ON public.clinical_records
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only();

-- ---------------------------------------------------------------------------
-- Audit: insert + soft-delete + anonymização
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_clinical_records_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'clinical_records', NEW.id, 'type', NULL, NEW.type, 'record-created'
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
      PERFORM public.log_audit_event(
        NEW.tenant_id, 'clinical_records', NEW.id,
        'deleted_at',
        COALESCE(OLD.deleted_at::text, 'NULL'),
        COALESCE(NEW.deleted_at::text, 'NULL'),
        'record-soft-deleted'
      );
    END IF;
    -- Anonymização: tracked como mudança nos campos de PII.
    IF NEW.content IS DISTINCT FROM OLD.content
       OR NEW.file_name IS DISTINCT FROM OLD.file_name
       OR NEW.file_url IS DISTINCT FROM OLD.file_url
    THEN
      PERFORM public.log_audit_event(
        NEW.tenant_id, 'clinical_records', NEW.id,
        'pii_fields', '[redacted-old]', '[redacted-new]', 'record-anonymized'
      );
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS clinical_records_audit ON public.clinical_records;
CREATE TRIGGER clinical_records_audit
  AFTER INSERT OR UPDATE ON public.clinical_records
  FOR EACH ROW EXECUTE FUNCTION public.audit_clinical_records_change();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.clinical_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clinical_records_read ON public.clinical_records;
CREATE POLICY clinical_records_read
  ON public.clinical_records FOR SELECT
  USING (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS clinical_records_admin_fin_insert ON public.clinical_records;
CREATE POLICY clinical_records_admin_fin_insert
  ON public.clinical_records FOR INSERT
  WITH CHECK (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() IN ('admin', 'financeiro')
  );

DROP POLICY IF EXISTS clinical_records_admin_fin_update ON public.clinical_records;
CREATE POLICY clinical_records_admin_fin_update
  ON public.clinical_records FOR UPDATE
  USING (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() IN ('admin', 'financeiro')
  );

REVOKE UPDATE, DELETE ON public.clinical_records FROM authenticated;
GRANT SELECT, INSERT ON public.clinical_records TO authenticated;
GRANT UPDATE (deleted_at) ON public.clinical_records TO authenticated;

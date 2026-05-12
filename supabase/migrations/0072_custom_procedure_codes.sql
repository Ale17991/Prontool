-- 0072 — Codigos de procedimento personalizados por clinica.
--
-- Cada clinica pode cadastrar seus proprios codigos de procedimento (alem
-- dos TUSS). Util para pacotes negociados, procedimentos locais, codigos
-- internos. Codigos sao por tenant e nao colidem com TUSS (sao tabelas
-- diferentes).
--
-- Comportamento append-only nos campos identitarios (id, tenant_id, code,
-- created_by, created_at). Campos editaveis: description, category,
-- deleted_at (soft delete). Mesma curva do expense_receipts (0059).

-- =========================================================================
-- (a) Tabela custom_procedure_codes
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.custom_procedure_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  code        TEXT NOT NULL CHECK (length(btrim(code)) BETWEEN 1 AND 50),
  description TEXT NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 200),
  category    TEXT NULL CHECK (category IS NULL OR length(btrim(category)) BETWEEN 1 AND 50),
  created_by  UUID NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ NULL,
  deleted_by  UUID NULL
);

-- Unicidade por (tenant, code) entre codigos ativos. Soft-deleted ficam de fora
-- pra permitir reaproveitar codigos descartados.
CREATE UNIQUE INDEX IF NOT EXISTS custom_procedure_codes_tenant_code_active_idx
  ON public.custom_procedure_codes (tenant_id, code)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS custom_procedure_codes_tenant_created_idx
  ON public.custom_procedure_codes (tenant_id, created_at DESC);

COMMENT ON TABLE public.custom_procedure_codes IS
  'Codigos de procedimento personalizados por clinica. Por tenant. Nao colidem com TUSS.';
COMMENT ON COLUMN public.custom_procedure_codes.code IS
  'Codigo livre (ex.: PKG-001, ORTO-15). Trim aplicado.';
COMMENT ON COLUMN public.custom_procedure_codes.deleted_at IS
  'Soft delete. NULL = ativo. Soft-deleted nao colidem por UNIQUE.';

-- =========================================================================
-- (b) RLS — leitura por tenant; INSERT/UPDATE controlados (sem DELETE fisico)
-- =========================================================================
ALTER TABLE public.custom_procedure_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS custom_procedure_codes_read ON public.custom_procedure_codes;
CREATE POLICY custom_procedure_codes_read ON public.custom_procedure_codes
  FOR SELECT USING (tenant_id = public.jwt_tenant_id());

-- INSERT: admin do tenant via service_role (route handler) — bloqueia direto
-- de authenticated. RPC adiante e desnecessario; INSERT vem do servidor.
REVOKE INSERT, UPDATE, DELETE ON public.custom_procedure_codes FROM authenticated;
GRANT SELECT ON public.custom_procedure_codes TO authenticated;

-- =========================================================================
-- (c) Trigger: campos identitarios sao imutaveis (append-only on core).
--     Edicao permitida em: description, category, deleted_at, deleted_by.
--     DELETE fisico bloqueado.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.enforce_custom_procedure_codes_mutability()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('postgres','supabase_admin','service_role','supabase_auth_admin') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'custom_procedure_codes: DELETE fisico bloqueado. Use soft delete.'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.id         IS DISTINCT FROM OLD.id
     OR NEW.tenant_id  IS DISTINCT FROM OLD.tenant_id
     OR NEW.code       IS DISTINCT FROM OLD.code
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'custom_procedure_codes: campos imutaveis (id, tenant_id, code, created_by, created_at).'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS custom_procedure_codes_immutable
  ON public.custom_procedure_codes;
CREATE TRIGGER custom_procedure_codes_immutable
  BEFORE UPDATE OR DELETE ON public.custom_procedure_codes
  FOR EACH ROW EXECUTE FUNCTION public.enforce_custom_procedure_codes_mutability();

-- =========================================================================
-- (d) Trigger: audit log
-- =========================================================================
CREATE OR REPLACE FUNCTION public.audit_custom_procedure_codes_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id,
      'custom_procedure_codes',
      NEW.id,
      'created',
      NULL,
      json_build_object(
        'code',        NEW.code,
        'description', NEW.description,
        'category',    NEW.category,
        'created_by',  NEW.created_by
      )::text,
      'codigo personalizado cadastrado'
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      PERFORM public.log_audit_event(
        NEW.tenant_id,
        'custom_procedure_codes',
        NEW.id,
        'soft_delete',
        OLD.code,
        NULL,
        COALESCE(NEW.deleted_by::text, 'sistema')
      );
    ELSIF OLD.description IS DISTINCT FROM NEW.description
       OR OLD.category    IS DISTINCT FROM NEW.category THEN
      PERFORM public.log_audit_event(
        NEW.tenant_id,
        'custom_procedure_codes',
        NEW.id,
        'updated',
        json_build_object('description', OLD.description, 'category', OLD.category)::text,
        json_build_object('description', NEW.description, 'category', NEW.category)::text,
        'edicao de codigo personalizado'
      );
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS custom_procedure_codes_audit_insert
  ON public.custom_procedure_codes;
CREATE TRIGGER custom_procedure_codes_audit_insert
  AFTER INSERT ON public.custom_procedure_codes
  FOR EACH ROW EXECUTE FUNCTION public.audit_custom_procedure_codes_change();

DROP TRIGGER IF EXISTS custom_procedure_codes_audit_update
  ON public.custom_procedure_codes;
CREATE TRIGGER custom_procedure_codes_audit_update
  AFTER UPDATE ON public.custom_procedure_codes
  FOR EACH ROW EXECUTE FUNCTION public.audit_custom_procedure_codes_change();

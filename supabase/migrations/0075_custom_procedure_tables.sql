-- 0075 — Tabelas pessoais de procedimentos (categorias por clinica).
--
-- Permite cada clinica criar "tabelas" personalizadas para agrupar
-- procedimentos nao listados (ex.: "Pacotes Ortodontia", "Consultas
-- avancadas"). Independente dos codigos TUSS 19/20/22 e dos codigos
-- personalizados (custom_procedure_codes, migration 0072).
--
-- Cada procedimento pode opcionalmente pertencer a UMA tabela pessoal
-- (procedures.custom_table_id). Restrito a unlisted (is_unlisted=true):
-- procedimentos TUSS usam as tabelas oficiais.
--
-- Append-only nos campos identitarios (id, tenant_id, name, created_by,
-- created_at). Editaveis: description, deleted_at, deleted_by.
-- Mesma curva de custom_procedure_codes (0072).

-- =========================================================================
-- (a) Tabela custom_procedure_tables
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.custom_procedure_tables (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  description TEXT NULL CHECK (description IS NULL OR length(btrim(description)) BETWEEN 1 AND 300),
  created_by  UUID NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ NULL,
  deleted_by  UUID NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS custom_procedure_tables_tenant_name_active_idx
  ON public.custom_procedure_tables (tenant_id, name)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS custom_procedure_tables_tenant_created_idx
  ON public.custom_procedure_tables (tenant_id, created_at DESC);

COMMENT ON TABLE public.custom_procedure_tables IS
  'Categorias/tabelas personalizadas de procedimentos por tenant. Agrupa procedimentos nao listados (is_unlisted=true).';

-- =========================================================================
-- (b) RLS — leitura por tenant; mutacao via service-role
-- =========================================================================
ALTER TABLE public.custom_procedure_tables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS custom_procedure_tables_read ON public.custom_procedure_tables;
CREATE POLICY custom_procedure_tables_read ON public.custom_procedure_tables
  FOR SELECT USING (tenant_id = public.jwt_tenant_id());

REVOKE INSERT, UPDATE, DELETE ON public.custom_procedure_tables FROM authenticated;
GRANT SELECT ON public.custom_procedure_tables TO authenticated;

-- =========================================================================
-- (c) Trigger: campos identitarios imutaveis (append-only on core)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.enforce_custom_procedure_tables_mutability()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('postgres','supabase_admin','service_role','supabase_auth_admin') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'custom_procedure_tables: DELETE fisico bloqueado. Use soft delete.'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.id         IS DISTINCT FROM OLD.id
     OR NEW.tenant_id  IS DISTINCT FROM OLD.tenant_id
     OR NEW.name       IS DISTINCT FROM OLD.name
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'custom_procedure_tables: campos imutaveis (id, tenant_id, name, created_by, created_at).'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS custom_procedure_tables_immutable
  ON public.custom_procedure_tables;
CREATE TRIGGER custom_procedure_tables_immutable
  BEFORE UPDATE OR DELETE ON public.custom_procedure_tables
  FOR EACH ROW EXECUTE FUNCTION public.enforce_custom_procedure_tables_mutability();

-- =========================================================================
-- (d) Trigger: audit
-- =========================================================================
CREATE OR REPLACE FUNCTION public.audit_custom_procedure_tables_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id,
      'custom_procedure_tables',
      NEW.id,
      'created',
      NULL,
      json_build_object(
        'name',        NEW.name,
        'description', NEW.description,
        'created_by',  NEW.created_by
      )::text,
      'tabela personalizada criada'
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      PERFORM public.log_audit_event(
        NEW.tenant_id,
        'custom_procedure_tables',
        NEW.id,
        'soft_delete',
        OLD.name,
        NULL,
        COALESCE(NEW.deleted_by::text, 'sistema')
      );
    ELSIF OLD.description IS DISTINCT FROM NEW.description THEN
      PERFORM public.log_audit_event(
        NEW.tenant_id,
        'custom_procedure_tables',
        NEW.id,
        'updated',
        OLD.description,
        NEW.description,
        'edicao de descricao da tabela personalizada'
      );
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS custom_procedure_tables_audit_insert
  ON public.custom_procedure_tables;
CREATE TRIGGER custom_procedure_tables_audit_insert
  AFTER INSERT ON public.custom_procedure_tables
  FOR EACH ROW EXECUTE FUNCTION public.audit_custom_procedure_tables_change();

DROP TRIGGER IF EXISTS custom_procedure_tables_audit_update
  ON public.custom_procedure_tables;
CREATE TRIGGER custom_procedure_tables_audit_update
  AFTER UPDATE ON public.custom_procedure_tables
  FOR EACH ROW EXECUTE FUNCTION public.audit_custom_procedure_tables_change();

-- =========================================================================
-- (e) procedures.custom_table_id FK
-- =========================================================================
ALTER TABLE public.procedures
  ADD COLUMN IF NOT EXISTS custom_table_id UUID NULL
    REFERENCES public.custom_procedure_tables(id) ON DELETE RESTRICT;

-- custom_table_id IS NOT NULL implica is_unlisted=true (tabelas pessoais
-- so se aplicam a procedimentos nao listados; TUSS usam as oficiais).
ALTER TABLE public.procedures
  DROP CONSTRAINT IF EXISTS procedures_custom_table_only_when_unlisted;
ALTER TABLE public.procedures
  ADD CONSTRAINT procedures_custom_table_only_when_unlisted
  CHECK (custom_table_id IS NULL OR is_unlisted = true);

-- Tenant consistency: a tabela referenciada deve pertencer ao mesmo tenant.
CREATE OR REPLACE FUNCTION public.check_procedure_custom_table_tenant()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_table_tenant UUID;
BEGIN
  IF NEW.custom_table_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT tenant_id INTO v_table_tenant
    FROM public.custom_procedure_tables
   WHERE id = NEW.custom_table_id;
  IF v_table_tenant IS NULL THEN
    RAISE EXCEPTION 'CUSTOM_TABLE_NOT_FOUND: tabela personalizada nao existe'
      USING ERRCODE = '23503';
  END IF;
  IF v_table_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'CUSTOM_TABLE_TENANT_MISMATCH: tabela pertence a outro tenant'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS procedures_custom_table_tenant_consistency
  ON public.procedures;
CREATE TRIGGER procedures_custom_table_tenant_consistency
  BEFORE INSERT OR UPDATE OF custom_table_id ON public.procedures
  FOR EACH ROW EXECUTE FUNCTION public.check_procedure_custom_table_tenant();

CREATE INDEX IF NOT EXISTS procedures_custom_table_id_idx
  ON public.procedures (custom_table_id)
  WHERE custom_table_id IS NOT NULL;

COMMENT ON COLUMN public.procedures.custom_table_id IS
  'FK para custom_procedure_tables. Quando preenchido, is_unlisted=true. Agrupa procedimentos personalizados em categorias da clinica.';

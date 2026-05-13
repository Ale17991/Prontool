-- Migration 0076 — Cadastro de impostos da clínica + alíquota por convênio + vínculo despesa↔imposto
-- Spec: specs/011-cadastro-impostos/spec.md
-- Plan: specs/011-cadastro-impostos/plan.md
-- Data model: specs/011-cadastro-impostos/data-model.md
--
-- Três deltas neste arquivo:
--   1. Nova tabela public.taxes (catálogo de impostos por tenant)
--      + triggers de imutabilidade, audit, RLS, GRANTs.
--   2. ALTER public.health_plans + tax_rate_bps INT NOT NULL DEFAULT 0
--      + trigger de audit (mudança de alíquota gera linha em audit_log).
--   3. ALTER public.expenses + tax_id UUID NULL FK
--      + CHECK (tax_id IS NULL OR category='impostos')
--      + extensão do trigger enforce_expenses_mutation (tax_id imutável)
--      + trigger cross-tenant defense-in-depth.
--
-- Append-only (Constitution I) preservado: triggers bloqueiam mudança de
-- colunas críticas em taxes; expenses.tax_id imutável após insert; health_plans
-- mutável (config) mas toda alteração de tax_rate_bps auditada (Constitution II).
-- RLS por tenant_id (Constitution III). RBAC admin/financeiro escrevem
-- (Constitution V). Alíquota em basis points (Constitution domain).

-- ============================================================================
-- 1) public.taxes — catálogo de impostos da clínica por tenant
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.taxes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  name         TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  rate_bps     INT  NOT NULL CHECK (rate_bps BETWEEN 0 AND 10000),
  description  TEXT CHECK (description IS NULL OR char_length(description) BETWEEN 1 AND 500),
  category     TEXT NOT NULL CHECK (category IN ('municipal', 'estadual', 'federal', 'outro')),
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  deleted_at   TIMESTAMPTZ,
  deleted_by   UUID REFERENCES auth.users(id) ON DELETE RESTRICT
);

-- Índice de listagem (status ativo no tenant) — filtrado por soft-delete.
CREATE INDEX IF NOT EXISTS taxes_tenant_active_idx
  ON public.taxes (tenant_id, is_active)
  WHERE deleted_at IS NULL;

-- Unicidade case-insensitive e trim-aware do nome, dentro do tenant,
-- ignorando linhas soft-deleted. FR-003.
CREATE UNIQUE INDEX IF NOT EXISTS taxes_active_name_unique_idx
  ON public.taxes (tenant_id, lower(trim(name)))
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Imutabilidade (Principle I) — bloqueia alteração de colunas estruturais.
-- rate_bps / description / is_active / deleted_at permanecem mutáveis.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_taxes_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role') THEN
    RETURN NEW;
  END IF;
  IF NEW.id         IS DISTINCT FROM OLD.id
     OR NEW.tenant_id  IS DISTINCT FROM OLD.tenant_id
     OR NEW.name       IS DISTINCT FROM OLD.name
     OR NEW.category   IS DISTINCT FROM OLD.category
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'taxes: id, tenant_id, name, category, created_at, created_by são imutáveis (audit-history integrity)';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS taxes_immutable_columns ON public.taxes;
CREATE TRIGGER taxes_immutable_columns
  BEFORE UPDATE ON public.taxes
  FOR EACH ROW EXECUTE FUNCTION public.enforce_taxes_mutation();

DROP TRIGGER IF EXISTS taxes_no_physical_delete ON public.taxes;
CREATE TRIGGER taxes_no_physical_delete
  BEFORE DELETE ON public.taxes
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only();

-- ---------------------------------------------------------------------------
-- Auditoria (Principle II) — uma linha por mutação relevante.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_taxes_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'taxes', NEW.id, 'created',
      NULL,
      format('%s|%s|%s%%', NEW.name, NEW.category, (NEW.rate_bps::numeric / 100)::text),
      'tax-created'
    );
    RETURN NEW;
  END IF;

  IF NEW.rate_bps IS DISTINCT FROM OLD.rate_bps THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'taxes', NEW.id,
      'rate_bps', OLD.rate_bps::text, NEW.rate_bps::text, 'tax-rate-updated'
    );
  END IF;
  IF NEW.description IS DISTINCT FROM OLD.description THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'taxes', NEW.id,
      'description', OLD.description, NEW.description, 'tax-description-updated'
    );
  END IF;
  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'taxes', NEW.id,
      'is_active', OLD.is_active::text, NEW.is_active::text,
      CASE WHEN NEW.is_active THEN 'tax-reactivated' ELSE 'tax-deactivated' END
    );
  END IF;
  IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at AND NEW.deleted_at IS NOT NULL THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'taxes', NEW.id,
      'deleted_at', NULL, NEW.deleted_at::text, 'tax-soft-deleted'
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS taxes_audit ON public.taxes;
CREATE TRIGGER taxes_audit
  AFTER INSERT OR UPDATE ON public.taxes
  FOR EACH ROW EXECUTE FUNCTION public.audit_taxes_change();

-- ---------------------------------------------------------------------------
-- RLS + grants — read por tenant; write apenas admin/financeiro.
-- ---------------------------------------------------------------------------
ALTER TABLE public.taxes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS taxes_read ON public.taxes;
CREATE POLICY taxes_read ON public.taxes FOR SELECT
  USING (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS taxes_insert ON public.taxes;
CREATE POLICY taxes_insert ON public.taxes FOR INSERT
  WITH CHECK (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() IN ('admin', 'financeiro')
  );

DROP POLICY IF EXISTS taxes_update ON public.taxes;
CREATE POLICY taxes_update ON public.taxes FOR UPDATE
  USING (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() IN ('admin', 'financeiro')
  )
  WITH CHECK (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() IN ('admin', 'financeiro')
  );

REVOKE UPDATE, DELETE ON public.taxes FROM authenticated;
GRANT SELECT, INSERT ON public.taxes TO authenticated;
GRANT UPDATE (rate_bps, description, is_active, deleted_at, deleted_by)
  ON public.taxes TO authenticated;

-- ============================================================================
-- 2) ALTER public.health_plans — coluna tax_rate_bps + audit trigger
-- ============================================================================
ALTER TABLE public.health_plans
  ADD COLUMN IF NOT EXISTS tax_rate_bps INT NOT NULL DEFAULT 0;

-- CHECK em separado para tornar a migration idempotente em reapply.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'health_plans_tax_rate_bps_check'
      AND conrelid = 'public.health_plans'::regclass
  ) THEN
    ALTER TABLE public.health_plans
      ADD CONSTRAINT health_plans_tax_rate_bps_check
      CHECK (tax_rate_bps BETWEEN 0 AND 10000);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.audit_health_plan_tax_rate_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tax_rate_bps IS DISTINCT FROM OLD.tax_rate_bps THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'health_plans', NEW.id,
      'tax_rate_bps', OLD.tax_rate_bps::text, NEW.tax_rate_bps::text,
      'plan-tax-rate-updated'
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS health_plans_tax_rate_audit ON public.health_plans;
CREATE TRIGGER health_plans_tax_rate_audit
  AFTER UPDATE OF tax_rate_bps ON public.health_plans
  FOR EACH ROW EXECUTE FUNCTION public.audit_health_plan_tax_rate_change();

-- ============================================================================
-- 3) ALTER public.expenses — coluna tax_id + CHECK + triggers
-- ============================================================================
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS tax_id UUID NULL REFERENCES public.taxes(id) ON DELETE RESTRICT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'expenses_tax_link_requires_impostos_category'
      AND conrelid = 'public.expenses'::regclass
  ) THEN
    ALTER TABLE public.expenses
      ADD CONSTRAINT expenses_tax_link_requires_impostos_category
      CHECK (tax_id IS NULL OR category = 'impostos');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS expenses_tax_idx
  ON public.expenses (tenant_id, tax_id)
  WHERE tax_id IS NOT NULL;

-- Reescreve enforce_expenses_mutation (definida em 0028) para incluir
-- tax_id na lista de colunas imutáveis pós-INSERT.
CREATE OR REPLACE FUNCTION public.enforce_expenses_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role') THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
     OR NEW.category IS DISTINCT FROM OLD.category
     OR NEW.competence_date IS DISTINCT FROM OLD.competence_date
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.tax_id IS DISTINCT FROM OLD.tax_id THEN
    RAISE EXCEPTION 'expenses: immutable record. Only soft-delete (deleted_at) is allowed.';
  END IF;

  RETURN NEW;
END $$;

-- Cross-tenant defense-in-depth: tax_id referenciado deve pertencer ao mesmo
-- tenant que o expense. A FK garante existência mas não tenant scope.
CREATE OR REPLACE FUNCTION public.enforce_expenses_tax_same_tenant()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  tax_tenant UUID;
BEGIN
  IF NEW.tax_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT tenant_id INTO tax_tenant FROM public.taxes WHERE id = NEW.tax_id;
  IF tax_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'expenses.tax_id: imposto pertence a outro tenant (cross-tenant violation)';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS expenses_tax_same_tenant ON public.expenses;
CREATE TRIGGER expenses_tax_same_tenant
  BEFORE INSERT ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.enforce_expenses_tax_same_tenant();

-- ============================================================================
-- PostgREST schema reload (forces type regeneration without restart)
-- ============================================================================
NOTIFY pgrst, 'reload schema';

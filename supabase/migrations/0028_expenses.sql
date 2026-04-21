-- Migração 0028: Gestão de despesas operacionais da clínica.
-- Regras: Isolamento de tenant, imutabilidade financeira (enforce_append_only) e soft-delete.

CREATE TABLE IF NOT EXISTS public.expenses (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  category          TEXT NOT NULL CHECK (category IN ('aluguel', 'equipamentos', 'materiais', 'pessoal', 'servicos', 'outros')),
  description       TEXT NOT NULL CHECK (char_length(description) BETWEEN 2 AND 500),
  supplier          TEXT CHECK (supplier IS NULL OR char_length(supplier) BETWEEN 2 AND 200),
  amount_cents      BIGINT NOT NULL CHECK (amount_cents > 0),
  competence_date   DATE NOT NULL,
  recurring         BOOLEAN NOT NULL DEFAULT false,
  frequency         TEXT CHECK (frequency IS NULL OR frequency IN ('mensal', 'semanal', 'anual')),
  created_by        UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ,
  deleted_by        UUID REFERENCES auth.users(id) ON DELETE RESTRICT,

  -- Invariante: Frequência obrigatória se recorrente
  CONSTRAINT expenses_recurring_frequency_check CHECK (
    (recurring = false AND frequency IS NULL) OR
    (recurring = true AND frequency IS NOT NULL)
  )
);

-- Índices para performance em relatórios financeiros
CREATE INDEX IF NOT EXISTS expenses_tenant_competence_idx ON public.expenses (tenant_id, competence_date DESC);
CREATE INDEX IF NOT EXISTS expenses_category_idx ON public.expenses (tenant_id, category);

-- Trigger para impedir modificações em colunas críticas (Imutabilidade Financeira)
CREATE OR REPLACE FUNCTION public.enforce_expenses_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role') THEN RETURN NEW; END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
     OR NEW.category IS DISTINCT FROM OLD.category
     OR NEW.competence_date IS DISTINCT FROM OLD.competence_date
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'expenses: immutable record. Only soft-delete (deleted_at) is allowed.';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS expenses_immutable_columns ON public.expenses;
CREATE TRIGGER expenses_immutable_columns
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.enforce_expenses_mutation();

DROP TRIGGER IF EXISTS expenses_no_physical_delete ON public.expenses;
CREATE TRIGGER expenses_no_physical_delete
  BEFORE DELETE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only();

-- RLS e permissões
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS expenses_read ON public.expenses;
CREATE POLICY expenses_read ON public.expenses FOR SELECT
  USING (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS expenses_insert ON public.expenses;
CREATE POLICY expenses_insert ON public.expenses FOR INSERT
  WITH CHECK (
    tenant_id = public.jwt_tenant_id() AND
    public.jwt_role() IN ('admin', 'financeiro')
  );

DROP POLICY IF EXISTS expenses_soft_delete ON public.expenses;
CREATE POLICY expenses_soft_delete ON public.expenses FOR UPDATE
  USING (
    tenant_id = public.jwt_tenant_id() AND
    public.jwt_role() = 'admin'
  )
  WITH CHECK (
    tenant_id = public.jwt_tenant_id() AND
    public.jwt_role() = 'admin'
  );

REVOKE UPDATE, DELETE ON public.expenses FROM authenticated;
GRANT SELECT, INSERT ON public.expenses TO authenticated;
GRANT UPDATE (deleted_at, deleted_by) ON public.expenses TO authenticated;

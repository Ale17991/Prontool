-- 0058 — Comprovantes de despesa (upload de PDF/JPG/PNG).
--
-- Decisoes:
--   1. As 3 colunas (file_name, file_url, file_size) sao NULLABLE — despesas
--      podem viver sem comprovante.
--   2. As colunas SAO MUTAVEIS apos INSERT, ao contrario do resto da row
--      (que e imutavel pelo trigger enforce_expenses_mutation). O usuario
--      pode adicionar/remover comprovante de despesa ja existente. O trigger
--      foi atualizado para permitir mudanca SOMENTE nessas 3 colunas (mais
--      deleted_at/deleted_by que ja estavam permitidas).
--   3. Bucket Storage 'expense-receipts' segue o mesmo padrao do
--      'clinical-files' (migration 0026): primeiro segmento do path =
--      tenant_id; RLS por (storage.foldername(name))[1].
--   4. Path interno: {tenant_id}/{expense_id}/{filename}.

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS receipt_file_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS receipt_file_url  TEXT NULL,
  ADD COLUMN IF NOT EXISTS receipt_file_size BIGINT NULL CHECK (
    receipt_file_size IS NULL OR receipt_file_size BETWEEN 0 AND 10485760
  );

COMMENT ON COLUMN public.expenses.receipt_file_name IS
  'Nome original do arquivo do comprovante (mostra ao usuario).';
COMMENT ON COLUMN public.expenses.receipt_file_url IS
  'Path do arquivo no bucket expense-receipts ({tenant_id}/{expense_id}/{filename}).';
COMMENT ON COLUMN public.expenses.receipt_file_size IS
  'Tamanho em bytes (max 10 MB).';

-- Atualiza o column-guard de expenses: receipt_* viram mutaveis.
CREATE OR REPLACE FUNCTION public.enforce_expenses_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role') THEN RETURN NEW; END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
     OR NEW.category IS DISTINCT FROM OLD.category
     OR NEW.competence_date IS DISTINCT FROM OLD.competence_date
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.supplier IS DISTINCT FROM OLD.supplier
     OR NEW.recurring IS DISTINCT FROM OLD.recurring
     OR NEW.frequency IS DISTINCT FROM OLD.frequency THEN
    RAISE EXCEPTION 'expenses: immutable record. Only soft-delete (deleted_at) and receipt_* columns are mutable.';
  END IF;

  RETURN NEW;
END $$;

-- Permite UPDATE em receipt_* + deleted_at/deleted_by para roles authenticated
-- de papeis admin/financeiro. A policy expenses_soft_delete original ja
-- cobre admin; precisamos relaxar para admin+financeiro alcancando os
-- campos receipt_*.
DROP POLICY IF EXISTS expenses_update ON public.expenses;
CREATE POLICY expenses_update ON public.expenses FOR UPDATE
  USING (
    tenant_id = public.jwt_tenant_id() AND
    public.jwt_role() IN ('admin', 'financeiro')
  )
  WITH CHECK (
    tenant_id = public.jwt_tenant_id() AND
    public.jwt_role() IN ('admin', 'financeiro')
  );

GRANT UPDATE (deleted_at, deleted_by, receipt_file_name, receipt_file_url, receipt_file_size)
  ON public.expenses TO authenticated;

-- =========================================================================
-- Storage bucket 'expense-receipts'
-- =========================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('expense-receipts', 'expense-receipts', false)
ON CONFLICT (id) DO NOTHING;

-- RLS no bucket — read = mesmo tenant; write/delete restritos a admin+financeiro
-- (recepcionista nao escreve/apaga, conforme regra do produto).

DROP POLICY IF EXISTS expense_receipts_tenant_read ON storage.objects;
CREATE POLICY expense_receipts_tenant_read
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'expense-receipts'
    AND (storage.foldername(name))[1] = public.jwt_tenant_id()::text
  );

DROP POLICY IF EXISTS expense_receipts_tenant_insert ON storage.objects;
CREATE POLICY expense_receipts_tenant_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'expense-receipts'
    AND (storage.foldername(name))[1] = public.jwt_tenant_id()::text
    AND public.jwt_role() IN ('admin', 'financeiro')
  );

-- Updates diretos via client bloqueados — substituicao de comprovante
-- e via API que apaga + reinsere com service-role (mantem auditoria).
DROP POLICY IF EXISTS expense_receipts_tenant_update ON storage.objects;

-- Delete: admin only para o "Remover comprovante" do produto. A api
-- usa service-role mas a policy serve como defesa em profundidade caso
-- o front passe a chamar Storage diretamente.
DROP POLICY IF EXISTS expense_receipts_tenant_delete ON storage.objects;
CREATE POLICY expense_receipts_tenant_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'expense-receipts'
    AND (storage.foldername(name))[1] = public.jwt_tenant_id()::text
    AND public.jwt_role() = 'admin'
  );

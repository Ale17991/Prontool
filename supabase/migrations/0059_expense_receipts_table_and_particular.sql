-- 0059 — Feature 006: Comprovantes 1:N + Atendimento particular.
--
-- Consolida em uma migration:
--   (a) tabela expense_receipts (substitui o modelo single-receipt da 0058)
--   (b) RLS + GRANT/REVOKE + audit + immutability triggers em expense_receipts
--   (c) backfill 1:1 -> 1:N a partir de expenses.receipt_file_*
--   (d) column-guard de expenses recriado para BLOQUEAR novos UPDATE em
--       receipt_file_* (devem ser tratadas como deprecated)
--   (e) ALTER appointments.plan_id e source_price_version_id para nullable
--   (f) trigger enforce_appointment_preconditions v2 com branch particular
--
-- Drop das colunas legadas em expenses sera 0060 (PR posterior, depois de
-- 1 semana de prod estavel).

-- =========================================================================
-- (a) expense_receipts — tabela canonica
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.expense_receipts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  expense_id      UUID NOT NULL REFERENCES public.expenses(id) ON DELETE RESTRICT,
  file_name       TEXT NOT NULL,
  storage_path    TEXT NOT NULL UNIQUE,
  file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes BETWEEN 1 AND 10485760),
  content_type    TEXT NOT NULL,
  uploaded_by     UUID NOT NULL,
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ NULL,
  deleted_by      UUID NULL,
  deleted_reason  TEXT NULL
);

CREATE INDEX IF NOT EXISTS expense_receipts_expense_idx
  ON public.expense_receipts (expense_id, deleted_at);

CREATE INDEX IF NOT EXISTS expense_receipts_tenant_uploaded_idx
  ON public.expense_receipts (tenant_id, uploaded_at DESC);

ALTER TABLE public.expense_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS expense_receipts_read ON public.expense_receipts;
CREATE POLICY expense_receipts_read ON public.expense_receipts
  FOR SELECT USING (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS expense_receipts_update ON public.expense_receipts;
CREATE POLICY expense_receipts_update ON public.expense_receipts
  FOR UPDATE
  USING (tenant_id = public.jwt_tenant_id() AND public.jwt_role() = 'admin')
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() = 'admin');

REVOKE INSERT, UPDATE, DELETE ON public.expense_receipts FROM authenticated;
GRANT SELECT ON public.expense_receipts TO authenticated;
GRANT UPDATE (deleted_at, deleted_by, deleted_reason)
  ON public.expense_receipts TO authenticated;

-- =========================================================================
-- (b) Imutabilidade + audit em expense_receipts
-- =========================================================================
CREATE OR REPLACE FUNCTION public.enforce_expense_receipt_mutability()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('postgres','supabase_admin','service_role','supabase_auth_admin') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'expense_receipts: physical delete forbidden';
  END IF;
  IF NEW.id            IS DISTINCT FROM OLD.id
     OR NEW.tenant_id  IS DISTINCT FROM OLD.tenant_id
     OR NEW.expense_id IS DISTINCT FROM OLD.expense_id
     OR NEW.file_name  IS DISTINCT FROM OLD.file_name
     OR NEW.storage_path    IS DISTINCT FROM OLD.storage_path
     OR NEW.file_size_bytes IS DISTINCT FROM OLD.file_size_bytes
     OR NEW.content_type    IS DISTINCT FROM OLD.content_type
     OR NEW.uploaded_by     IS DISTINCT FROM OLD.uploaded_by
     OR NEW.uploaded_at     IS DISTINCT FROM OLD.uploaded_at THEN
    RAISE EXCEPTION 'expense_receipts: only deleted_at/deleted_by/deleted_reason are mutable';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS expense_receipts_immutable ON public.expense_receipts;
CREATE TRIGGER expense_receipts_immutable
  BEFORE UPDATE OR DELETE ON public.expense_receipts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_expense_receipt_mutability();

CREATE OR REPLACE FUNCTION public.audit_expense_receipt_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id,
      'expense_receipts',
      NEW.id,
      'upload',
      NULL,
      NEW.file_name,
      'expense_id=' || NEW.expense_id::text || ';size=' || NEW.file_size_bytes::text
    );
  ELSIF TG_OP = 'UPDATE' AND OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id,
      'expense_receipts',
      NEW.id,
      'soft_delete',
      OLD.file_name,
      NULL,
      COALESCE(NEW.deleted_reason, 'no reason given')
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS audit_expense_receipt_insert ON public.expense_receipts;
CREATE TRIGGER audit_expense_receipt_insert
  AFTER INSERT ON public.expense_receipts
  FOR EACH ROW EXECUTE FUNCTION public.audit_expense_receipt_change();

DROP TRIGGER IF EXISTS audit_expense_receipt_softdelete ON public.expense_receipts;
CREATE TRIGGER audit_expense_receipt_softdelete
  AFTER UPDATE ON public.expense_receipts
  FOR EACH ROW EXECUTE FUNCTION public.audit_expense_receipt_change();

-- =========================================================================
-- (c) Backfill 1:1 -> 1:N a partir de expenses.receipt_file_*
-- =========================================================================
DO $$
DECLARE
  v_inserted INT := 0;
BEGIN
  INSERT INTO public.expense_receipts
    (tenant_id, expense_id, file_name, storage_path, file_size_bytes, content_type, uploaded_by, uploaded_at)
  SELECT
    tenant_id,
    id,
    receipt_file_name,
    receipt_file_url,
    receipt_file_size,
    'application/octet-stream',
    created_by,
    created_at
  FROM public.expenses
  WHERE receipt_file_url IS NOT NULL
    AND receipt_file_size IS NOT NULL
    AND receipt_file_name IS NOT NULL
  ON CONFLICT (storage_path) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RAISE NOTICE '[0059 backfill] expense_receipts: % linhas migradas', v_inserted;
END $$;

-- =========================================================================
-- (d) Column-guard de expenses: bloqueia novos UPDATE em receipt_file_*
-- =========================================================================
CREATE OR REPLACE FUNCTION public.enforce_expenses_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('postgres','supabase_admin','service_role') THEN RETURN NEW; END IF;

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
     OR NEW.frequency IS DISTINCT FROM OLD.frequency
     OR NEW.receipt_file_name IS DISTINCT FROM OLD.receipt_file_name
     OR NEW.receipt_file_url IS DISTINCT FROM OLD.receipt_file_url
     OR NEW.receipt_file_size IS DISTINCT FROM OLD.receipt_file_size THEN
    RAISE EXCEPTION
      'expenses: immutable record. Only soft-delete (deleted_at/deleted_by) is allowed. Use expense_receipts for attachments.';
  END IF;

  RETURN NEW;
END $$;

REVOKE UPDATE (receipt_file_name, receipt_file_url, receipt_file_size)
  ON public.expenses FROM authenticated;

-- =========================================================================
-- (e) appointments.plan_id e source_price_version_id viram nullable
-- =========================================================================
ALTER TABLE public.appointments ALTER COLUMN plan_id DROP NOT NULL;
ALTER TABLE public.appointments ALTER COLUMN source_price_version_id DROP NOT NULL;

-- =========================================================================
-- (f) Trigger enforce_appointment_preconditions v2 com branch particular
-- =========================================================================
CREATE OR REPLACE FUNCTION public.enforce_appointment_preconditions()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  proc_tuss TEXT;
  tuss_valid_to DATE;
  active_price UUID;
BEGIN
  -- TUSS check (caminho comum)
  SELECT p.tuss_code INTO proc_tuss
  FROM public.procedures p
  WHERE p.id = NEW.procedure_id AND p.tenant_id = NEW.tenant_id;

  IF proc_tuss IS NULL THEN
    RAISE EXCEPTION 'APPOINTMENT_PROCEDURE_UNKNOWN: procedure not found in tenant'
      USING ERRCODE = '23514';
  END IF;

  SELECT valid_to INTO tuss_valid_to
  FROM public.tuss_codes WHERE code = proc_tuss;

  IF tuss_valid_to IS NOT NULL
     AND tuss_valid_to < (NEW.appointment_at AT TIME ZONE 'UTC')::date THEN
    RAISE EXCEPTION 'TUSS_CODE_RETIRED: code=% was retired on %', proc_tuss, tuss_valid_to
      USING ERRCODE = '23514';
  END IF;

  -- Price-version check (apenas com plan_id presente — convenio).
  IF NEW.plan_id IS NOT NULL THEN
    SELECT id INTO active_price
    FROM public.price_versions
    WHERE tenant_id = NEW.tenant_id
      AND procedure_id = NEW.procedure_id
      AND plan_id = NEW.plan_id
      AND valid_from <= (NEW.appointment_at AT TIME ZONE 'UTC')::date
    ORDER BY valid_from DESC, created_at DESC
    LIMIT 1;

    IF active_price IS NULL THEN
      RAISE EXCEPTION 'APPOINTMENT_PRICE_MISSING: no active price for (procedure, plan) on appointment date'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.source_price_version_id IS NULL THEN
      NEW.source_price_version_id := active_price;
    END IF;
  ELSE
    -- Caminho particular: source_price_version_id deve ser NULL.
    -- frozen_amount_cents > 0 ja garantido pelo CHECK na tabela.
    IF NEW.source_price_version_id IS NOT NULL THEN
      RAISE EXCEPTION 'APPOINTMENT_PARTICULAR_NO_PRICE_VERSION: plan_id is null but source_price_version_id was provided'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END $$;

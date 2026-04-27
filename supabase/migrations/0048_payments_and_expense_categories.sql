-- 0048 — Sistema de pagamentos (payment_records + payment_installments)
-- e expansão das categorias de despesa (impostos, manutencao).
--
-- Append-only:
--   - payment_records: insert + update apenas em payment_status,
--     paid_amount_cents, paid_at, notes.
--   - payment_installments: insert + update apenas em status, paid_at,
--     paid_amount_cents, payment_method.
--   - DELETE bloqueado nas duas tabelas (enforce_append_only).
-- RLS por tenant_id. Audit trigger registra criação e mudanças de status.

-- ============================================================================
-- payment_records
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.payment_records (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  patient_id         UUID NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  appointment_id     UUID REFERENCES public.appointments(id) ON DELETE RESTRICT,
  treatment_step_id  UUID REFERENCES public.treatment_plan_steps(id) ON DELETE RESTRICT,
  total_amount_cents BIGINT NOT NULL CHECK (total_amount_cents >= 0),
  installments       INT NOT NULL DEFAULT 1 CHECK (installments BETWEEN 1 AND 60),
  payment_method     TEXT NOT NULL CHECK (
    payment_method IN ('dinheiro', 'pix', 'cartao_credito', 'cartao_debito', 'boleto', 'convenio', 'outro')
  ),
  payment_status     TEXT NOT NULL DEFAULT 'pendente' CHECK (
    payment_status IN ('pendente', 'parcial', 'pago', 'cancelado')
  ),
  paid_amount_cents  BIGINT NOT NULL DEFAULT 0 CHECK (paid_amount_cents >= 0),
  paid_at            TIMESTAMPTZ,
  notes              TEXT,
  created_by         UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_records_patient_idx
  ON public.payment_records (tenant_id, patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_records_appointment_idx
  ON public.payment_records (tenant_id, appointment_id)
  WHERE appointment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payment_records_status_idx
  ON public.payment_records (tenant_id, payment_status);

CREATE OR REPLACE FUNCTION public.enforce_payment_records_mutability()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role') THEN RETURN NEW; END IF;
  IF NEW.id                  IS DISTINCT FROM OLD.id
     OR NEW.tenant_id         IS DISTINCT FROM OLD.tenant_id
     OR NEW.patient_id        IS DISTINCT FROM OLD.patient_id
     OR NEW.appointment_id    IS DISTINCT FROM OLD.appointment_id
     OR NEW.treatment_step_id IS DISTINCT FROM OLD.treatment_step_id
     OR NEW.total_amount_cents IS DISTINCT FROM OLD.total_amount_cents
     OR NEW.installments      IS DISTINCT FROM OLD.installments
     OR NEW.payment_method    IS DISTINCT FROM OLD.payment_method
     OR NEW.created_by        IS DISTINCT FROM OLD.created_by
     OR NEW.created_at        IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'payment_records: only payment_status, paid_amount_cents, paid_at, notes are mutable';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS payment_records_immutable_columns ON public.payment_records;
CREATE TRIGGER payment_records_immutable_columns
  BEFORE UPDATE ON public.payment_records
  FOR EACH ROW EXECUTE FUNCTION public.enforce_payment_records_mutability();

DROP TRIGGER IF EXISTS payment_records_no_delete ON public.payment_records;
CREATE TRIGGER payment_records_no_delete
  BEFORE DELETE ON public.payment_records
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only();

CREATE OR REPLACE FUNCTION public.audit_payment_records_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'payment_records', NEW.id,
      'payment_status', NULL, NEW.payment_status, 'payment-created'
    );
  ELSIF TG_OP = 'UPDATE' AND NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'payment_records', NEW.id,
      'payment_status', OLD.payment_status, NEW.payment_status, 'status-change'
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS payment_records_audit ON public.payment_records;
CREATE TRIGGER payment_records_audit
  AFTER INSERT OR UPDATE ON public.payment_records
  FOR EACH ROW EXECUTE FUNCTION public.audit_payment_records_change();

ALTER TABLE public.payment_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_records_read ON public.payment_records;
CREATE POLICY payment_records_read ON public.payment_records FOR SELECT
  USING (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS payment_records_admin_fin_insert ON public.payment_records;
CREATE POLICY payment_records_admin_fin_insert ON public.payment_records FOR INSERT
  WITH CHECK (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() IN ('admin', 'financeiro')
  );

DROP POLICY IF EXISTS payment_records_admin_fin_update ON public.payment_records;
CREATE POLICY payment_records_admin_fin_update ON public.payment_records FOR UPDATE
  USING (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() IN ('admin', 'financeiro')
  );

GRANT SELECT, INSERT ON public.payment_records TO authenticated;
GRANT UPDATE (payment_status, paid_amount_cents, paid_at, notes) ON public.payment_records TO authenticated;

-- ============================================================================
-- payment_installments
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.payment_installments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  payment_record_id   UUID NOT NULL REFERENCES public.payment_records(id) ON DELETE RESTRICT,
  installment_number  INT NOT NULL CHECK (installment_number >= 1),
  amount_cents        BIGINT NOT NULL CHECK (amount_cents >= 0),
  due_date            DATE NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pendente' CHECK (
    status IN ('pendente', 'pago', 'atrasado', 'cancelado')
  ),
  paid_at             TIMESTAMPTZ,
  paid_amount_cents   BIGINT NOT NULL DEFAULT 0 CHECK (paid_amount_cents >= 0),
  payment_method      TEXT CHECK (
    payment_method IS NULL OR payment_method IN
    ('dinheiro', 'pix', 'cartao_credito', 'cartao_debito', 'boleto', 'convenio', 'outro')
  ),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (payment_record_id, installment_number)
);

CREATE INDEX IF NOT EXISTS payment_installments_record_idx
  ON public.payment_installments (tenant_id, payment_record_id, installment_number);
CREATE INDEX IF NOT EXISTS payment_installments_due_idx
  ON public.payment_installments (tenant_id, due_date)
  WHERE status = 'pendente';

CREATE OR REPLACE FUNCTION public.enforce_payment_installments_mutability()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role') THEN RETURN NEW; END IF;
  IF NEW.id                 IS DISTINCT FROM OLD.id
     OR NEW.tenant_id         IS DISTINCT FROM OLD.tenant_id
     OR NEW.payment_record_id IS DISTINCT FROM OLD.payment_record_id
     OR NEW.installment_number IS DISTINCT FROM OLD.installment_number
     OR NEW.amount_cents       IS DISTINCT FROM OLD.amount_cents
     OR NEW.due_date           IS DISTINCT FROM OLD.due_date
     OR NEW.created_at         IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'payment_installments: only status, paid_at, paid_amount_cents, payment_method are mutable';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS payment_installments_immutable_columns ON public.payment_installments;
CREATE TRIGGER payment_installments_immutable_columns
  BEFORE UPDATE ON public.payment_installments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_payment_installments_mutability();

DROP TRIGGER IF EXISTS payment_installments_no_delete ON public.payment_installments;
CREATE TRIGGER payment_installments_no_delete
  BEFORE DELETE ON public.payment_installments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only();

CREATE OR REPLACE FUNCTION public.audit_payment_installments_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'payment_installments', NEW.id,
      'status', NULL, NEW.status,
      'installment-' || NEW.installment_number::text || '-created'
    );
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'payment_installments', NEW.id,
      'status', OLD.status, NEW.status, 'installment-status-change'
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS payment_installments_audit ON public.payment_installments;
CREATE TRIGGER payment_installments_audit
  AFTER INSERT OR UPDATE ON public.payment_installments
  FOR EACH ROW EXECUTE FUNCTION public.audit_payment_installments_change();

ALTER TABLE public.payment_installments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_installments_read ON public.payment_installments;
CREATE POLICY payment_installments_read ON public.payment_installments FOR SELECT
  USING (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS payment_installments_admin_fin_insert ON public.payment_installments;
CREATE POLICY payment_installments_admin_fin_insert ON public.payment_installments FOR INSERT
  WITH CHECK (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() IN ('admin', 'financeiro')
  );

DROP POLICY IF EXISTS payment_installments_admin_fin_update ON public.payment_installments;
CREATE POLICY payment_installments_admin_fin_update ON public.payment_installments FOR UPDATE
  USING (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() IN ('admin', 'financeiro')
  );

GRANT SELECT, INSERT ON public.payment_installments TO authenticated;
GRANT UPDATE (status, paid_at, paid_amount_cents, payment_method) ON public.payment_installments TO authenticated;

-- ============================================================================
-- Expense categories: add 'impostos' and 'manutencao'
-- ============================================================================
ALTER TABLE public.expenses
  DROP CONSTRAINT IF EXISTS expenses_category_check;
ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_category_check
  CHECK (category IN ('aluguel', 'equipamentos', 'materiais', 'pessoal', 'servicos', 'impostos', 'manutencao', 'outros'));

NOTIFY pgrst, 'reload schema';

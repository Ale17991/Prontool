-- 0156 — Quitações de honorários de profissionais liberais por período.
--
-- Registro simples de pagamento (marcar pago) dos honorários de participação
-- (appointment_assistants) por profissional, em um período livre (de/até).
-- Independente do repasse mensal (monthly_payouts) — a clínica escolhe qual
-- fluxo usar para liberais. Aditiva e idempotente.

CREATE TABLE IF NOT EXISTS public.liberal_payment_settlements (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  doctor_id    UUID NOT NULL REFERENCES public.doctors(id),
  period_from  DATE NOT NULL,
  period_to    DATE NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents >= 0),
  note         TEXT,
  paid_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_by      UUID REFERENCES auth.users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS liberal_payment_settlements_idx
  ON public.liberal_payment_settlements (tenant_id, doctor_id, period_from DESC);

ALTER TABLE public.liberal_payment_settlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS liberal_payment_settlements_read ON public.liberal_payment_settlements;
CREATE POLICY liberal_payment_settlements_read ON public.liberal_payment_settlements
  FOR SELECT
  USING (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS liberal_payment_settlements_write ON public.liberal_payment_settlements;
CREATE POLICY liberal_payment_settlements_write ON public.liberal_payment_settlements
  FOR ALL
  USING (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() IN ('admin', 'financeiro')
  )
  WITH CHECK (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() IN ('admin', 'financeiro')
  );

COMMENT ON TABLE public.liberal_payment_settlements IS
  'Backlog — quitação de honorários de liberais por período (de/até); independente do repasse mensal.';

NOTIFY pgrst, 'reload schema';

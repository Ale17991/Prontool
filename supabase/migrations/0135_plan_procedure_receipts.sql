-- 0135 — Recebíveis por procedimento de convênio (backlog 4/1 + 4/2).
--
-- Para cada LINHA DE PROCEDIMENTO de convênio (appointment_procedures com
-- plan_id) a clínica marca o status do recebimento da operadora:
--   pendente (default, sem linha) / recebido / glosado / nao_recebido.
-- Marcação um-a-um ou em massa; alimenta o filtro e o widget de "recebido ×
-- não recebido" por convênio.
--
-- Independente do TISS (vale p/ qualquer clínica). Ausência de linha = pendente
-- (status default derivado), então só gravamos quando o usuário marca algo.
--
-- Tabela MUTÁVEL (o status transiciona); a trilha fica em audit_log via app.

CREATE TABLE IF NOT EXISTS public.plan_procedure_receipts (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  appointment_procedure_id UUID NOT NULL REFERENCES public.appointment_procedures(id) ON DELETE CASCADE,
  appointment_id           UUID NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  plan_id                  UUID NOT NULL REFERENCES public.health_plans(id),
  status                   TEXT NOT NULL DEFAULT 'pendente'
                             CHECK (status IN ('pendente', 'recebido', 'glosado', 'nao_recebido')),
  received_amount_cents    BIGINT NULL CHECK (received_amount_cents IS NULL OR received_amount_cents >= 0),
  received_at              DATE NULL,
  note                     TEXT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by               UUID NULL REFERENCES auth.users(id),
  UNIQUE (appointment_procedure_id)
);

CREATE INDEX IF NOT EXISTS plan_procedure_receipts_tenant_plan_status_idx
  ON public.plan_procedure_receipts (tenant_id, plan_id, status);
CREATE INDEX IF NOT EXISTS plan_procedure_receipts_appointment_idx
  ON public.plan_procedure_receipts (tenant_id, appointment_id);

ALTER TABLE public.plan_procedure_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS plan_procedure_receipts_read ON public.plan_procedure_receipts;
CREATE POLICY plan_procedure_receipts_read ON public.plan_procedure_receipts
  FOR SELECT USING (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS plan_procedure_receipts_write ON public.plan_procedure_receipts;
CREATE POLICY plan_procedure_receipts_write ON public.plan_procedure_receipts
  FOR ALL
  USING  (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN ('admin', 'financeiro'))
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN ('admin', 'financeiro'));

COMMENT ON TABLE public.plan_procedure_receipts IS
  'Backlog 4/1+4/2 — status de recebimento da operadora por linha de procedimento de convênio. Ausência de linha = pendente.';

NOTIFY pgrst, 'reload schema';

-- 0127 — tiss_lote_payments: conciliação de recebimentos por lote TISS (US6).
--
-- Modela a "conta a receber da operadora" de forma TISS-nativa: cada lote
-- exportado representa um valor faturado (soma das guias); os recebimentos do
-- convênio (inclusive parciais por glosa) são lançados aqui (append-only).
-- Quando o recebido alcança o faturado, as guias do lote passam a `paga`.
--
-- DECISÃO (usuário, 2026-06-17): o repasse médico permanece sobre o valor
-- FATURADO (regra atual) — esta tabela NÃO altera close_monthly_payout nem a
-- comissão; é puramente financeira (entrada de caixa da operadora).
--
-- Numerada 0127 para não colidir com 0126 (branch de financeiro). Aditiva,
-- idempotente.

CREATE TABLE IF NOT EXISTS public.tiss_lote_payments (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  lote_id            UUID        NOT NULL REFERENCES public.tiss_lotes(id) ON DELETE CASCADE,
  amount_cents       BIGINT      NOT NULL CHECK (amount_cents > 0),
  received_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  note               TEXT        NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id UUID        NOT NULL REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS tiss_lote_payments_lote_idx
  ON public.tiss_lote_payments (tenant_id, lote_id);

-- Append-only puro (correção = nova linha; não há UPDATE/DELETE).
DROP TRIGGER IF EXISTS tiss_lote_payments_append_only ON public.tiss_lote_payments;
CREATE TRIGGER tiss_lote_payments_append_only
  BEFORE UPDATE OR DELETE ON public.tiss_lote_payments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only_columns('');

ALTER TABLE public.tiss_lote_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tiss_lote_payments_tenant_read ON public.tiss_lote_payments;
CREATE POLICY tiss_lote_payments_tenant_read ON public.tiss_lote_payments
  FOR SELECT USING (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS tiss_lote_payments_billing_write ON public.tiss_lote_payments;
CREATE POLICY tiss_lote_payments_billing_write ON public.tiss_lote_payments
  FOR ALL
  USING  (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN ('admin','financeiro'))
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN ('admin','financeiro'));

COMMENT ON TABLE public.tiss_lote_payments IS
  'Feature 029 (US6) — recebimentos do convênio por lote TISS (append-only). Não afeta repasse: regra de comissão permanece sobre o valor faturado.';

NOTIFY pgrst, 'reload schema';

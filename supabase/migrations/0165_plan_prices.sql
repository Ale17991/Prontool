-- 0165 — Preços de plano (feature 044, base do MRR no /admin).
--
-- Config GLOBAL de plataforma: mensalidade (centavos, BRL) por plano. Editável
-- pelo super-admin no /admin; o MRR usa o valor vigente. NÃO é preço de
-- atendimento/fatura (Princípio I não se aplica — não há vínculo a registro
-- financeiro histórico). A mudança é registrada via logger de plataforma +
-- updated_by/updated_at (audit_log é tenant-scoped e não cabe aqui).

CREATE TABLE IF NOT EXISTS public.plan_prices (
  plan        TEXT PRIMARY KEY CHECK (plan IN ('essencial', 'pro', 'clinica', 'legacy')),
  price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID NULL
);

COMMENT ON TABLE public.plan_prices IS
  'Feature 044 — preço mensal (centavos BRL) por plano; base do MRR no /admin. Config global de plataforma, editável pelo super-admin.';

DROP TRIGGER IF EXISTS plan_prices_touch_updated_at ON public.plan_prices;
CREATE TRIGGER plan_prices_touch_updated_at
  BEFORE UPDATE ON public.plan_prices
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.plan_prices ENABLE ROW LEVEL SECURITY;
-- Sem policies: só service_role lê/escreve (super-admin via service client).
-- Não é dado de clínica; authenticated não acessa.

-- Seed: 1 linha por plano (preço 0 — editar no /admin).
INSERT INTO public.plan_prices (plan, price_cents)
VALUES ('essencial', 0), ('pro', 0), ('clinica', 0), ('legacy', 0)
ON CONFLICT (plan) DO NOTHING;

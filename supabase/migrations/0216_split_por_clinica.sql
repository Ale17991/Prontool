-- =========================================================================
-- 0216 — O repasse ao parceiro passa a ser por CLÍNICA
--
-- A 0212 pôs a regra de split no PARCEIRO, assumindo uma taxa por acordo
-- comercial. Errado: o parceiro vende mais de um plano, e o que a clínica paga
-- (e portanto o que se repassa) depende do plano que ELA contratou. Com a regra
-- no parceiro, todas as clínicas dele dividiriam igual — e a primeira que
-- contratasse um plano diferente seria repassada errado, em silêncio, todo mês.
--
--   D1  A regra da CLÍNICA é a que executa. As colunas de `billing_partners`
--       permanecem como VALOR PADRÃO: pré-preenchem o formulário e valem
--       quando a clínica não tem regra própria — mesmo padrão de
--       `tenant_billing.price_cents`, que é NULL quando se usa o preço de
--       tabela do plano.
--
--   D2  Sem regra em lugar nenhum, NÃO se divide. É a direção segura: o
--       dinheiro fica conosco e vira conversa comercial, que se resolve.
--       Dividir por engano manda dinheiro para fora, e isso não volta.
--
--   D3  Percentual OU valor fixo, nunca os dois — mesma restrição da 0212.
--       Duas regras para a mesma divisão é a origem garantida de divergência
--       entre o que a tela mostra e o que o Asaas executa.
--
-- O SNAPSHOT em `billing_charges.split_amount_cents` continua sendo a verdade
-- do que foi repassado: mudar o plano da clínica amanhã não reescreve o que já
-- saiu do caixa.
--
-- Constituição: III (tabela de plataforma, service_role-only); V RBAC.
-- Reversibilidade: aditiva e idempotente.
-- =========================================================================

ALTER TABLE public.tenant_billing
  ADD COLUMN IF NOT EXISTS split_percent_bps INTEGER NULL,
  ADD COLUMN IF NOT EXISTS split_fixed_cents INTEGER NULL;

COMMENT ON COLUMN public.tenant_billing.split_percent_bps IS
  'Repasse ao parceiro em pontos-base sobre a cobranca desta clinica (2500 = 25%). NULL = usa o padrao do parceiro. Exclusivo com split_fixed_cents.';
COMMENT ON COLUMN public.tenant_billing.split_fixed_cents IS
  'Repasse ao parceiro em centavos por cobranca desta clinica. NULL = usa o padrao do parceiro. Exclusivo com split_percent_bps.';

-- Faixas válidas, iguais às da 0212.
ALTER TABLE public.tenant_billing
  DROP CONSTRAINT IF EXISTS tenant_billing_split_percent_range;
ALTER TABLE public.tenant_billing
  ADD CONSTRAINT tenant_billing_split_percent_range CHECK (
    split_percent_bps IS NULL OR (split_percent_bps > 0 AND split_percent_bps <= 10000)
  );

ALTER TABLE public.tenant_billing
  DROP CONSTRAINT IF EXISTS tenant_billing_split_fixed_positive;
ALTER TABLE public.tenant_billing
  ADD CONSTRAINT tenant_billing_split_fixed_positive CHECK (
    split_fixed_cents IS NULL OR split_fixed_cents > 0
  );

-- D3: no máximo um dos dois modos.
ALTER TABLE public.tenant_billing
  DROP CONSTRAINT IF EXISTS tenant_billing_one_split_mode;
ALTER TABLE public.tenant_billing
  ADD CONSTRAINT tenant_billing_one_split_mode CHECK (
    split_percent_bps IS NULL OR split_fixed_cents IS NULL
  );

-- Regra de repasse sem parceiro para receber não faz sentido e seria um número
-- parado esperando alguém interpretá-lo errado.
ALTER TABLE public.tenant_billing
  DROP CONSTRAINT IF EXISTS tenant_billing_split_needs_partner;
ALTER TABLE public.tenant_billing
  ADD CONSTRAINT tenant_billing_split_needs_partner CHECK (
    partner_id IS NOT NULL
    OR (split_percent_bps IS NULL AND split_fixed_cents IS NULL)
  );

COMMENT ON COLUMN public.billing_partners.split_percent_bps IS
  'PADRAO do parceiro (0216). A regra que executa e a da clinica em tenant_billing; esta so pre-preenche e vale quando a clinica nao tem a propria.';
COMMENT ON COLUMN public.billing_partners.split_fixed_cents IS
  'PADRAO do parceiro (0216). Ver comentario de split_percent_bps.';

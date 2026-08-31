-- =========================================================================
-- 0212 — Cobrança da assinatura da Clinni via Asaas (+ split de parceiro)
--
-- ESCOPO: como a CLINNI recebe das clínicas. Não confundir com o financeiro
-- da clínica (payment_records/payment_installments), que registra o que o
-- PACIENTE paga à clínica. São dois fluxos de dinheiro distintos, em contas
-- distintas, e misturá-los faria o MRR da plataforma somar receita alheia.
--
-- Decisões que esta migration materializa:
--
--   D1  A credencial do Asaas da PLATAFORMA fica em env (`ASAAS_API_KEY`), não
--       em tabela: é uma só, é nossa, e não pertence a tenant nenhum. O padrão
--       de credencial cifrada por linha (0110/0185) vale para o lado
--       clínica→paciente, que ganha `tenant_asaas_config` aqui já preparada.
--
--   D2  `billing_charges` é ESPELHO do Asaas, nunca a verdade. O Asaas é quem
--       sabe se entrou dinheiro; aqui guardamos o suficiente para a tela do
--       /admin não depender de chamada externa a cada render. Reconciliação
--       reescreve a linha pelo `asaas_payment_id`.
--
--   D3  O split é gravado como SNAPSHOT na cobrança (`partner_id` +
--       `split_amount_cents`), não recalculado na leitura. Mudar a regra do
--       parceiro amanhã não pode reescrever o que já foi dividido — o oposto
--       da classificação de exames (050), onde derivar é o certo justamente
--       porque nada saiu do caixa.
--
--   D4  `billing_webhook_events` é append-only e tem UNIQUE no id do evento.
--       O Asaas reentrega evento até receber 200; sem a chave, uma reentrega
--       de PAYMENT_RECEIVED reativaria uma clínica cancelada depois.
--
-- Constituição: III multi-tenant (tabelas de plataforma são service_role-only;
-- as que a clínica pode ver filtram por jwt_tenant_id); V RBAC (escrita só por
-- service_role — o /admin usa service client atrás de requireSuperAdmin).
-- Reversibilidade: aditiva e idempotente.
-- =========================================================================

-- =========================================================================
-- 1. billing_partners — parceiro comercial com carteira e regra de split
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.billing_partners (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT        NOT NULL CHECK (length(btrim(name)) > 0),
  -- Identificador estável usado pela integração (ex.: 'zeelu'). É por ele que
  -- o parceiro se identifica, nunca pelo nome de exibição, que muda.
  slug               TEXT        NOT NULL UNIQUE
                       CHECK (slug ~ '^[a-z0-9][a-z0-9_-]{1,48}$'),
  -- Carteira Asaas que RECEBE o split. NULL = parceiro cadastrado mas ainda
  -- sem conta; nesse estado nenhuma cobrança pode ser dividida para ele.
  asaas_wallet_id    TEXT        NULL
                       CHECK (asaas_wallet_id IS NULL OR length(btrim(asaas_wallet_id)) > 0),
  -- Split em pontos-base (2500 = 25,00%) OU valor fixo em centavos. Nunca os
  -- dois: duas regras para a mesma divisão é origem garantida de divergência
  -- entre o que a tela mostra e o que o Asaas executa.
  split_percent_bps  INTEGER     NULL
                       CHECK (split_percent_bps IS NULL
                              OR (split_percent_bps > 0 AND split_percent_bps <= 10000)),
  split_fixed_cents  INTEGER     NULL
                       CHECK (split_fixed_cents IS NULL OR split_fixed_cents > 0),
  status             TEXT        NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'inactive')),
  notes              TEXT        NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT billing_partners_one_split_mode CHECK (
    split_percent_bps IS NULL OR split_fixed_cents IS NULL
  )
);

COMMENT ON TABLE public.billing_partners IS
  'Parceiro comercial que recebe parte da assinatura via split do Asaas (ex.: zee.lu). Tabela de PLATAFORMA (sem tenant_id) — service_role-only.';
COMMENT ON COLUMN public.billing_partners.split_percent_bps IS
  'Pontos-base sobre o valor da cobranca (2500 = 25%). Exclusivo com split_fixed_cents.';

DROP TRIGGER IF EXISTS billing_partners_touch_updated_at ON public.billing_partners;
CREATE TRIGGER billing_partners_touch_updated_at
  BEFORE UPDATE ON public.billing_partners
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.billing_partners ENABLE ROW LEVEL SECURITY;
-- Sem policy para `authenticated`: dado comercial da plataforma.

-- =========================================================================
-- 2. tenant_billing — assinatura de cada clínica no Asaas (1:1 com tenants)
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.tenant_billing (
  tenant_id             UUID        PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- Ids do Asaas. UNIQUE porque um customer/subscription pertence a uma
  -- clínica só — sem isso, um erro no /admin faria duas clínicas apontarem
  -- para a mesma assinatura e uma pagaria pela outra.
  asaas_customer_id     TEXT        NULL UNIQUE,
  asaas_subscription_id TEXT        NULL UNIQUE,
  billing_cycle         TEXT        NOT NULL DEFAULT 'MONTHLY'
                          CHECK (billing_cycle IN ('MONTHLY', 'QUARTERLY',
                                                   'SEMIANNUALLY', 'YEARLY')),
  -- Forma de pagamento oferecida. UNDEFINED = o Asaas mostra PIX, boleto e
  -- cartão na mesma fatura e o cliente escolhe; é o padrão porque converte
  -- mais e não obriga a clínica a decidir antes de ver.
  billing_type          TEXT        NOT NULL DEFAULT 'UNDEFINED'
                          CHECK (billing_type IN ('UNDEFINED', 'PIX', 'BOLETO', 'CREDIT_CARD')),
  -- Preço negociado. NULL = usa plan_prices do plano vigente. Guardar o
  -- override aqui, e não em plan_prices, é o que permite desconto pontual sem
  -- mexer no preço de tabela e sem falsear o MRR das outras clínicas.
  price_cents           INTEGER     NULL CHECK (price_cents IS NULL OR price_cents >= 0),
  next_due_date         DATE        NULL,
  -- Parceiro que recebe split desta assinatura (ex.: a zee.lu atende a clínica).
  partner_id            UUID        NULL REFERENCES public.billing_partners(id) ON DELETE RESTRICT,
  notes                 TEXT        NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tenant_billing IS
  'Assinatura da clinica no Asaas (cobranca da Clinni). price_cents NULL => preco de tabela do plano (plan_prices). partner_id => split.';

CREATE INDEX IF NOT EXISTS tenant_billing_partner_idx
  ON public.tenant_billing (partner_id) WHERE partner_id IS NOT NULL;

DROP TRIGGER IF EXISTS tenant_billing_touch_updated_at ON public.tenant_billing;
CREATE TRIGGER tenant_billing_touch_updated_at
  BEFORE UPDATE ON public.tenant_billing
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.tenant_billing ENABLE ROW LEVEL SECURITY;

-- A clínica pode ver a PRÓPRIA assinatura (valor, ciclo, vencimento). Não há
-- credencial nesta tabela; esconder o próprio vencimento não protege nada e
-- impediria uma tela "minha assinatura" de existir sem service client.
DROP POLICY IF EXISTS tenant_billing_read_own ON public.tenant_billing;
CREATE POLICY tenant_billing_read_own ON public.tenant_billing
  FOR SELECT TO authenticated
  USING (tenant_id = public.jwt_tenant_id());

GRANT SELECT ON public.tenant_billing TO authenticated;

-- =========================================================================
-- 3. billing_charges — espelho das cobranças emitidas (D2)
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.billing_charges (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  asaas_payment_id      TEXT        NOT NULL UNIQUE,
  asaas_subscription_id TEXT        NULL,
  amount_cents          INTEGER     NOT NULL CHECK (amount_cents >= 0),
  -- Líquido creditado (bruto − taxa do Asaas − split). Só é conhecido depois
  -- da liquidação; antes disso é NULL, e NULL aqui NÃO é zero.
  net_amount_cents      INTEGER     NULL,
  status                TEXT        NOT NULL DEFAULT 'pendente'
                          CHECK (status IN ('pendente', 'confirmado', 'recebido',
                                            'vencido', 'estornado', 'cancelado', 'falhou')),
  billing_type          TEXT        NULL,
  due_date              DATE        NOT NULL,
  paid_at               TIMESTAMPTZ NULL,
  -- Links servidos pelo Asaas. Guardamos a URL, não o QR do PIX: o payload
  -- expira e é barato de rebuscar, e persistir código de pagamento é passivo.
  invoice_url           TEXT        NULL,
  bank_slip_url         TEXT        NULL,
  -- Snapshot do split efetivamente enviado ao Asaas (D3).
  partner_id            UUID        NULL REFERENCES public.billing_partners(id) ON DELETE RESTRICT,
  split_amount_cents    INTEGER     NULL
                          CHECK (split_amount_cents IS NULL OR split_amount_cents >= 0),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.billing_charges IS
  'Espelho local das cobrancas da assinatura no Asaas. A verdade e o Asaas; a reconciliacao faz UPSERT por asaas_payment_id. split_amount_cents e snapshot, nunca recalculado.';

CREATE INDEX IF NOT EXISTS billing_charges_tenant_due_idx
  ON public.billing_charges (tenant_id, due_date DESC);
CREATE INDEX IF NOT EXISTS billing_charges_status_idx
  ON public.billing_charges (status, due_date);
CREATE INDEX IF NOT EXISTS billing_charges_partner_idx
  ON public.billing_charges (partner_id, due_date DESC) WHERE partner_id IS NOT NULL;

DROP TRIGGER IF EXISTS billing_charges_touch_updated_at ON public.billing_charges;
CREATE TRIGGER billing_charges_touch_updated_at
  BEFORE UPDATE ON public.billing_charges
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.billing_charges ENABLE ROW LEVEL SECURITY;

-- A clínica vê as próprias faturas (é o extrato dela conosco).
DROP POLICY IF EXISTS billing_charges_read_own ON public.billing_charges;
CREATE POLICY billing_charges_read_own ON public.billing_charges
  FOR SELECT TO authenticated
  USING (tenant_id = public.jwt_tenant_id());

GRANT SELECT ON public.billing_charges TO authenticated;

-- =========================================================================
-- 4. billing_webhook_events — append-only, idempotência do Asaas (D4)
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.billing_webhook_events (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- id do EVENTO no Asaas (evt_...). É a chave de idempotência: o Asaas
  -- reentrega até receber 200, e reprocessar PAYMENT_RECEIVED reativaria uma
  -- clínica cancelada depois.
  asaas_event_id TEXT        NOT NULL UNIQUE,
  event          TEXT        NOT NULL,
  payment_id     TEXT        NULL,
  tenant_id      UUID        NULL REFERENCES public.tenants(id) ON DELETE SET NULL,
  payload        JSONB       NOT NULL,
  processed_at   TIMESTAMPTZ NULL,
  process_error  TEXT        NULL,
  received_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.billing_webhook_events IS
  'Eventos crus do webhook do Asaas. Append-only exceto a marcacao de processamento — o historico do que o gateway nos contou e prova e nao se reescreve.';

CREATE INDEX IF NOT EXISTS billing_webhook_events_payment_idx
  ON public.billing_webhook_events (payment_id) WHERE payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS billing_webhook_events_unprocessed_idx
  ON public.billing_webhook_events (received_at) WHERE processed_at IS NULL;

-- Anti-DELETE. O UPDATE fica permitido SÓ para carimbar processed_at/
-- process_error/tenant_id: sem isso, um evento que falhou no meio não teria
-- como ser reprocessado sem perder o registro de que chegou.
CREATE OR REPLACE FUNCTION public.enforce_billing_event_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'billing_webhook_events e append-only (DELETE bloqueado)';
  END IF;
  IF NEW.asaas_event_id IS DISTINCT FROM OLD.asaas_event_id
     OR NEW.event       IS DISTINCT FROM OLD.event
     OR NEW.payload     IS DISTINCT FROM OLD.payload
     OR NEW.received_at IS DISTINCT FROM OLD.received_at THEN
    RAISE EXCEPTION 'billing_webhook_events: so processed_at/process_error/tenant_id podem mudar';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS billing_webhook_events_immutable ON public.billing_webhook_events;
CREATE TRIGGER billing_webhook_events_immutable
  BEFORE UPDATE OR DELETE ON public.billing_webhook_events
  FOR EACH ROW EXECUTE FUNCTION public.enforce_billing_event_immutable();

ALTER TABLE public.billing_webhook_events ENABLE ROW LEVEL SECURITY;
-- Sem policy para `authenticated`: payload cru do gateway.

-- =========================================================================
-- 5. tenant_asaas_config — lado clínica→paciente (PREPARADO, desligado)
--
-- A clínica cobrar o PACIENTE por PIX/boleto é outro fluxo: o dinheiro é dela,
-- então a credencial é dela, cifrada por linha (padrão 0110/0185) e jamais em
-- env. Nasce `enabled=false`; nenhuma rota a consome ainda.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.tenant_asaas_config (
  tenant_id          UUID        PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- API key da clínica no Asaas, cifrada via enc_text_with_key
  -- (PATIENT_DATA_ENCRYPTION_KEY). Nunca retornada ao browser.
  api_key_enc        BYTEA       NOT NULL,
  wallet_id          TEXT        NULL,
  environment        TEXT        NOT NULL DEFAULT 'sandbox'
                       CHECK (environment IN ('sandbox', 'production')),
  enabled            BOOLEAN     NOT NULL DEFAULT FALSE,
  connected_at       TIMESTAMPTZ NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id UUID        NULL REFERENCES auth.users(id)
);

COMMENT ON TABLE public.tenant_asaas_config IS
  'PREPARADO (nao consumido ainda) — conta Asaas da propria clinica para cobrar o paciente. api_key_enc cifrada; nunca vai ao browser.';

DROP TRIGGER IF EXISTS tenant_asaas_config_touch_updated_at ON public.tenant_asaas_config;
CREATE TRIGGER tenant_asaas_config_touch_updated_at
  BEFORE UPDATE ON public.tenant_asaas_config
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.tenant_asaas_config ENABLE ROW LEVEL SECURITY;
-- Sem policy para `authenticated`: a linha carrega credencial.

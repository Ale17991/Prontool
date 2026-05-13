-- 0082 — Relaxa o limite de mudancas de valor de 1x por dia para 4x por dia.
--
-- Contexto: tanto `doctor_commission_history` quanto `price_versions` tinham
-- UNIQUE constraint sobre `(tenant_id, *, valid_from)`. Como `valid_from` e
-- DATE, isso significava que apenas UMA mudanca por dia era permitida.
--
-- Mudanca: remove os UNIQUE constraints e adiciona triggers BEFORE INSERT
-- que limitam a 4 mudancas por dia para a mesma combinacao (tenant,
-- profissional) ou (tenant, procedimento, plano).
--
-- Impacto na resolucao de vigencia: como ja havia tiebreaker `created_at DESC`
-- nas views/funcoes que resolvem head de chain (price_versions_with_vigencia,
-- doctor_commission_current, resolve-price, resolve-commission), multiplas
-- rows com mesmo valid_from se ordenam naturalmente — a mais recente vence.
-- O chain `previous_version_id` em price_versions continua refletindo a
-- ordem temporal real (cada nova versao aponta pra anterior carregada via
-- SELECT FOR UPDATE na RPC).

-- ==========================================================================
-- (a) Remove UNIQUE constraints
-- ==========================================================================

ALTER TABLE public.doctor_commission_history
  DROP CONSTRAINT IF EXISTS doctor_commission_history_tenant_id_doctor_id_valid_from_key;

ALTER TABLE public.price_versions
  DROP CONSTRAINT IF EXISTS price_versions_tenant_id_procedure_id_plan_id_valid_from_key;

-- ==========================================================================
-- (b) Trigger: limite diario de comissoes
-- ==========================================================================

CREATE OR REPLACE FUNCTION public.enforce_commission_daily_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.doctor_commission_history
  WHERE tenant_id = NEW.tenant_id
    AND doctor_id = NEW.doctor_id
    AND valid_from = NEW.valid_from;
  IF v_count >= 4 THEN
    RAISE EXCEPTION 'COMMISSION_DAILY_LIMIT_EXCEEDED: ja existem 4 alteracoes de comissao para este profissional em %', NEW.valid_from
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS enforce_commission_daily_limit ON public.doctor_commission_history;
CREATE TRIGGER enforce_commission_daily_limit
BEFORE INSERT ON public.doctor_commission_history
FOR EACH ROW EXECUTE FUNCTION public.enforce_commission_daily_limit();

-- ==========================================================================
-- (c) Trigger: limite diario de versoes de preco
-- ==========================================================================

CREATE OR REPLACE FUNCTION public.enforce_price_version_daily_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.price_versions
  WHERE tenant_id = NEW.tenant_id
    AND procedure_id = NEW.procedure_id
    AND plan_id = NEW.plan_id
    AND valid_from = NEW.valid_from;
  IF v_count >= 4 THEN
    RAISE EXCEPTION 'PRICE_DAILY_LIMIT_EXCEEDED: ja existem 4 alteracoes de preco para esta combinacao em %', NEW.valid_from
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS enforce_price_version_daily_limit ON public.price_versions;
CREATE TRIGGER enforce_price_version_daily_limit
BEFORE INSERT ON public.price_versions
FOR EACH ROW EXECUTE FUNCTION public.enforce_price_version_daily_limit();

-- ==========================================================================
-- (d) RPC create_price_version: capturar erro do trigger
-- ==========================================================================
-- A RPC (migration 0023) ja capturava unique_violation. Como agora a
-- limitacao vem via trigger BEFORE INSERT, adicionamos WHEN OTHERS
-- detectando a mensagem do RAISE e devolvendo um status proprio.

CREATE OR REPLACE FUNCTION public.create_price_version(
  p_tenant_id        UUID,
  p_procedure_id     UUID,
  p_plan_id          UUID,
  p_amount_cents     BIGINT,
  p_valid_from       DATE,
  p_reason           TEXT,
  p_expected_head_id UUID,
  p_actor_id         UUID
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_head      public.price_versions%ROWTYPE;
  new_id            UUID := gen_random_uuid();
BEGIN
  SELECT * INTO current_head
  FROM public.price_versions
  WHERE tenant_id = p_tenant_id
    AND procedure_id = p_procedure_id
    AND plan_id = p_plan_id
  ORDER BY valid_from DESC, created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF (current_head.id IS NULL AND p_expected_head_id IS NOT NULL)
     OR (current_head.id IS NOT NULL AND current_head.id IS DISTINCT FROM p_expected_head_id)
  THEN
    RETURN jsonb_build_object(
      'status', 'conflict',
      'current_head_id', current_head.id,
      'current_amount_cents', current_head.amount_cents
    );
  END IF;

  BEGIN
    INSERT INTO public.price_versions (
      id, tenant_id, procedure_id, plan_id, amount_cents,
      valid_from, reason, created_by, previous_version_id
    ) VALUES (
      new_id, p_tenant_id, p_procedure_id, p_plan_id, p_amount_cents,
      p_valid_from, p_reason, p_actor_id, current_head.id
    );
  EXCEPTION
    WHEN unique_violation THEN
      -- Compat: caso a migration 0082 nao tenha rodado ainda e o UNIQUE
      -- continue existindo. Mapeia pra duplicate_valid_from.
      RETURN jsonb_build_object(
        'status', 'duplicate_valid_from',
        'current_head_id', current_head.id
      );
    WHEN OTHERS THEN
      IF SQLERRM LIKE '%PRICE_DAILY_LIMIT_EXCEEDED%' THEN
        RETURN jsonb_build_object(
          'status', 'daily_limit_exceeded',
          'current_head_id', current_head.id
        );
      END IF;
      RAISE;
  END;

  RETURN jsonb_build_object(
    'status', 'created',
    'version', jsonb_build_object(
      'id', new_id,
      'tenant_id', p_tenant_id,
      'procedure_id', p_procedure_id,
      'plan_id', p_plan_id,
      'amount_cents', p_amount_cents,
      'valid_from', p_valid_from,
      'reason', p_reason,
      'created_by', p_actor_id,
      'previous_version_id', current_head.id
    )
  );
END $$;

GRANT EXECUTE ON FUNCTION public.create_price_version(
  UUID, UUID, UUID, BIGINT, DATE, TEXT, UUID, UUID
) TO service_role;

NOTIFY pgrst, 'reload schema';

-- T108 — RPC transacional para criar nova versão de preço com
-- concorrência otimista. Bloqueia o head atual da chain
-- (tenant, procedure, plan) com SELECT … FOR UPDATE, compara com
-- expected_head_id e ou insere a nova linha ou devolve o conflict.
--
-- Retorna jsonb com os campos:
--   { status: 'created', version: { ... } }     -- sucesso
--   { status: 'conflict', current_head_id, current_amount_cents } -- 409
--   { status: 'duplicate_valid_from', current_head_id }            -- 23505
--
-- O caller (handler T112) decide o HTTP status e dispara denyAudit
-- quando status='conflict' (FR-005b).

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
  -- Pega o head mais recente da chain e bloqueia.
  SELECT * INTO current_head
  FROM public.price_versions
  WHERE tenant_id = p_tenant_id
    AND procedure_id = p_procedure_id
    AND plan_id = p_plan_id
  ORDER BY valid_from DESC, created_at DESC
  LIMIT 1
  FOR UPDATE;

  -- Concorrência otimista: o head no banco precisa bater com o token
  -- carregado pelo cliente. NULL no cliente = primeira versão da chain.
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
      -- Belt-and-braces: outro admin gravou exatamente o mesmo
      -- valid_from antes da nossa transação tomar lock. Mapeia pra
      -- conflito também.
      RETURN jsonb_build_object(
        'status', 'duplicate_valid_from',
        'current_head_id', current_head.id
      );
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

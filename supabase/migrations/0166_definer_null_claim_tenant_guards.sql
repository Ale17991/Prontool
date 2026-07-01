-- 0166 — Correção de segurança: guarda de tenant em SECURITY DEFINER contra
-- claim NULL (revisão de segurança 2026-07).
--
-- PROBLEMA: algumas RPCs SECURITY DEFINER usam a guarda
--     IF v_jwt_tenant IS NOT NULL AND v_jwt_tenant <> p_tenant_id THEN RAISE
-- que checa SÓ o tenant e é BURLADA quando `jwt_tenant_id()` é NULL. Um usuário
-- AUTENTICADO com claim de tenant NULL (onboarding sem clínica; usuário de
-- tenant suspenso — a 0089 remove o claim) que conheça o UUID de outra clínica
-- passa pela guarda e lê/escreve dados cross-tenant.
--
-- CORREÇÃO: padrão já estabelecido em 0085/0090 —
--     IF public.jwt_role() <> 'service_role'
--        AND (v_jwt_tenant IS NULL OR v_jwt_tenant <> p_tenant_id) THEN RAISE
-- `jwt_role()` nunca é NULL numa requisição real (cai no claim base do Supabase
-- 'authenticated'/'anon'/'service_role'), então isso exige claim de tenant
-- presente E batendo para authenticated, mantendo o passe do service-role (que
-- chama com jwt de tenant nulo e confia no p_tenant_id resolvido na rota).
--
-- Funções corrigidas aqui: dental_chart_current (0134), tenant_cash_balance_at
-- (0095, sem guarda nenhuma), attach_materials_to_appointment (0061) e
-- create_appointment_with_procedures_and_materials (0102). A não-usada
-- create_appointment_with_materials (0061) tem o EXECUTE revogado de
-- authenticated. As de payout close/reopen (0095/0130) NÃO são afetadas: já
-- checam papel (v_role <> 'service_role' → 'authenticated' → levanta).

-- =========================================================================
-- 1. dental_chart_current — corpo idêntico à 0134, só a guarda muda.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.dental_chart_current(
  p_tenant_id  UUID,
  p_patient_id UUID
) RETURNS TABLE (
  id              UUID,
  tooth_fdi       SMALLINT,
  surface         TEXT,
  status_id       UUID,
  note            TEXT,
  recorded_at     TIMESTAMPTZ,
  appointment_id  UUID,
  created_by      UUID
) LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_jwt_tenant UUID;
BEGIN
  v_jwt_tenant := public.jwt_tenant_id();
  IF public.jwt_role() <> 'service_role'
     AND (v_jwt_tenant IS NULL OR v_jwt_tenant <> p_tenant_id) THEN
    RAISE EXCEPTION 'TENANT_MISMATCH' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT DISTINCT ON (e.tooth_fdi, e.surface)
           e.id, e.tooth_fdi, e.surface, e.status_id, e.note,
           e.recorded_at, e.appointment_id, e.created_by
      FROM public.dental_chart_entries e
     WHERE e.tenant_id = p_tenant_id
       AND e.patient_id = p_patient_id
     ORDER BY e.tooth_fdi, e.surface, e.recorded_at DESC;
END $$;

REVOKE ALL ON FUNCTION public.dental_chart_current(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dental_chart_current(UUID, UUID) TO authenticated, service_role;

-- =========================================================================
-- 2. tenant_cash_balance_at — 0095 não tinha guarda ALGUMA (comentário admitia
--    "caller MUST validate"). Convertida p/ plpgsql com a guarda padrão.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.tenant_cash_balance_at(
  p_tenant_id UUID,
  p_date DATE
) RETURNS BIGINT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.jwt_role() <> 'service_role'
     AND (public.jwt_tenant_id() IS NULL OR public.jwt_tenant_id() <> p_tenant_id) THEN
    RAISE EXCEPTION 'TENANT_MISMATCH' USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE((
    SELECT SUM(amount_cents)
      FROM public.tenant_cash_balance_adjustments
     WHERE tenant_id = p_tenant_id
       AND effective_from <= p_date
  ), 0)::BIGINT;
END $$;

REVOKE EXECUTE ON FUNCTION public.tenant_cash_balance_at(UUID, DATE) FROM public;
GRANT EXECUTE ON FUNCTION public.tenant_cash_balance_at(UUID, DATE) TO authenticated, service_role;

-- =========================================================================
-- 3. create_appointment_with_materials — NÃO usada pelo app (só nos tipos
--    gerados). Revoga EXECUTE de authenticated para fechar o vetor sem recriar
--    o corpo (a guarda dela também é a fraca). service_role mantém acesso.
-- =========================================================================
REVOKE EXECUTE ON FUNCTION public.create_appointment_with_materials(
  UUID, UUID, UUID, UUID, UUID, UUID, UUID, INTEGER, INTEGER,
  TIMESTAMPTZ, INTEGER, TEXT, TEXT, UUID, JSONB
) FROM authenticated;

-- =========================================================================
-- 4. attach_materials_to_appointment — corpo byte-exato da 0061, guarda linha 206.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.attach_materials_to_appointment(
  p_appointment_id UUID,
  p_materials      JSONB,
  p_actor          UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id    UUID;
  v_jwt_tenant   UUID;
  v_inserted     JSONB;
BEGIN
  v_jwt_tenant := public.jwt_tenant_id();

  SELECT tenant_id INTO v_tenant_id
    FROM public.appointments
   WHERE id = p_appointment_id;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'APPOINTMENT_NOT_FOUND', ERRCODE = '02000';
  END IF;

  -- Multi-tenant: authenticated PRECISA de claim presente e batendo; service_role passa.
  IF public.jwt_role() <> 'service_role'
     AND (v_jwt_tenant IS NULL OR v_jwt_tenant <> v_tenant_id) THEN
    RAISE EXCEPTION USING MESSAGE = 'APPOINTMENT_NOT_FOUND', ERRCODE = '02000';
  END IF;

  -- Bloqueia anexacao a atendimento cancelado.
  IF EXISTS (
    SELECT 1 FROM public.appointment_reversals WHERE appointment_id = p_appointment_id
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'APPOINTMENT_REVERSED', ERRCODE = '23514';
  END IF;

  IF p_materials IS NULL OR jsonb_typeof(p_materials) <> 'array' OR jsonb_array_length(p_materials) = 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'MATERIALS_REQUIRED', ERRCODE = '22023';
  END IF;

  WITH inserted AS (
    INSERT INTO public.appointment_materials (
      tenant_id, appointment_id, tuss_code, tuss_description, quantity, created_by
    )
    SELECT
      v_tenant_id,
      p_appointment_id,
      (item->>'tuss_code')::text,
      (item->>'tuss_description')::text,
      COALESCE((item->>'quantity')::int, 1),
      p_actor
    FROM jsonb_array_elements(p_materials) AS item
    RETURNING id, tuss_code, tuss_description, quantity, created_at, created_by
  )
  SELECT jsonb_agg(jsonb_build_object(
    'id',                id,
    'tuss_code',         tuss_code,
    'tuss_description',  tuss_description,
    'quantity',          quantity,
    'created_at',        created_at,
    'created_by',        created_by
  )) INTO v_inserted FROM inserted;

  RETURN jsonb_build_object(
    'appointment_id', p_appointment_id,
    'materials',      COALESCE(v_inserted, '[]'::jsonb)
  );
END $$;

GRANT EXECUTE ON FUNCTION public.attach_materials_to_appointment(UUID, JSONB, UUID)
  TO authenticated;

-- =========================================================================
-- 5. create_appointment_with_procedures_and_materials — corpo byte-exato da
--    0102, guarda linha 49.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.create_appointment_with_procedures_and_materials(
  p_tenant_id              UUID,
  p_patient_id             UUID,
  p_doctor_id              UUID,
  p_appointment_at         TIMESTAMPTZ,
  p_duration_minutes       INTEGER,
  p_observacoes            TEXT,
  p_source                 TEXT,
  p_actor                  UUID,
  p_procedures             JSONB,
  p_frozen_commission_bps  INTEGER,
  p_source_commission_history_id UUID,
  p_materials              JSONB,
  p_source_raw_event_id    UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_jwt_tenant       UUID;
  v_appointment_id   UUID;
  v_primary          JSONB;
  v_primary_proc     UUID;
  v_primary_plan     UUID;
  v_primary_price    UUID;
  v_total_cents      BIGINT := 0;
  v_procedures_count INTEGER := 0;
  v_materials_count  INTEGER := 0;
BEGIN
  v_jwt_tenant := public.jwt_tenant_id();
  -- Multi-tenant: authenticated PRECISA de claim presente e batendo; service_role passa.
  IF public.jwt_role() <> 'service_role'
     AND (v_jwt_tenant IS NULL OR v_jwt_tenant <> p_tenant_id) THEN
    RAISE EXCEPTION USING MESSAGE = 'TENANT_MISMATCH', ERRCODE = '42501';
  END IF;

  IF p_procedures IS NULL OR jsonb_typeof(p_procedures) <> 'array'
     OR jsonb_array_length(p_procedures) = 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'PROCEDURES_REQUIRED', ERRCODE = '22023';
  END IF;

  -- Soma e quantidade de linhas. Total = SUM(line_amount_cents * quantity);
  -- COALESCE preserva compat com payloads legados sem a chave 'quantity'.
  SELECT
    COALESCE(SUM(
      (item->>'line_amount_cents')::bigint
      * COALESCE((item->>'quantity')::int, 1)
    ), 0),
    COUNT(*)::int
  INTO v_total_cents, v_procedures_count
  FROM jsonb_array_elements(p_procedures) AS item;

  SELECT item INTO v_primary
  FROM jsonb_array_elements(p_procedures) AS item
  WHERE (item->>'sequence')::int = 1
  LIMIT 1;

  IF v_primary IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'PROCEDURES_MISSING_SEQUENCE_ONE', ERRCODE = '22023';
  END IF;

  v_primary_proc  := (v_primary->>'procedure_id')::uuid;
  v_primary_plan  := NULLIF(v_primary->>'plan_id', '')::uuid;
  v_primary_price := NULLIF(v_primary->>'source_price_version_id', '')::uuid;

  -- Atendimento gratuito (total=0) passa. So' rejeitamos total negativo
  -- (defesa contra payload corrompido — line_amount_cents NOT NULL CHECK >= 0).
  IF v_total_cents < 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'PROCEDURES_TOTAL_NEGATIVE', ERRCODE = '22023';
  END IF;

  INSERT INTO public.appointments (
    tenant_id, patient_id, doctor_id, procedure_id, plan_id,
    source_price_version_id, source_commission_history_id, source_raw_event_id,
    frozen_amount_cents, frozen_commission_bps,
    appointment_at, duration_minutes, source, observacoes
  ) VALUES (
    p_tenant_id, p_patient_id, p_doctor_id, v_primary_proc, v_primary_plan,
    v_primary_price, p_source_commission_history_id, p_source_raw_event_id,
    v_total_cents, p_frozen_commission_bps,
    p_appointment_at, p_duration_minutes, p_source, p_observacoes
  ) RETURNING id INTO v_appointment_id;

  INSERT INTO public.appointment_procedures (
    tenant_id, appointment_id, procedure_id, plan_id, source_price_version_id,
    line_amount_cents, vigente_amount_cents, amount_was_overridden, sequence,
    created_by, notes, quantity
  )
  SELECT
    p_tenant_id,
    v_appointment_id,
    (item->>'procedure_id')::uuid,
    NULLIF(item->>'plan_id', '')::uuid,
    NULLIF(item->>'source_price_version_id', '')::uuid,
    (item->>'line_amount_cents')::bigint,
    (item->>'vigente_amount_cents')::bigint,
    COALESCE((item->>'amount_was_overridden')::boolean, false),
    (item->>'sequence')::int,
    p_actor,
    NULLIF(item->>'notes', ''),
    COALESCE((item->>'quantity')::int, 1)
  FROM jsonb_array_elements(p_procedures) AS item;

  IF p_materials IS NOT NULL AND jsonb_typeof(p_materials) = 'array'
     AND jsonb_array_length(p_materials) > 0 THEN
    INSERT INTO public.appointment_materials (
      tenant_id, appointment_id, tuss_code, tuss_description, quantity, created_by
    )
    SELECT
      p_tenant_id,
      v_appointment_id,
      (item->>'tuss_code')::text,
      (item->>'tuss_description')::text,
      COALESCE((item->>'quantity')::int, 1),
      p_actor
    FROM jsonb_array_elements(p_materials) AS item;
    GET DIAGNOSTICS v_materials_count = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'appointment_id',     v_appointment_id,
    'procedures_count',   v_procedures_count,
    'materials_count',    v_materials_count,
    'frozen_amount_cents', v_total_cents
  );
END $$;

NOTIFY pgrst, 'reload schema';

-- 0173_material_costs_create_rpc.sql
-- Feature 045 — completa a 0172.
--
-- A 0172 estendeu `attach_materials_to_appointment` e
-- `create_appointment_with_materials` para aceitar custo + catálogo +
-- insumo livre, mas NÃO tocou em `create_appointment_with_procedures_and_materials`
-- — a RPC usada pelo cadastro manual (que é o caminho real da UI). Sem esta
-- migration, materiais lançados JUNTO com o atendimento perdiam
-- `unit_cost_cents`/`material_id`/`material_name` silenciosamente.
--
-- Esta migration reescreve APENAS o bloco de INSERT de materiais para
-- propagar as novas colunas. `tuss_code`/`tuss_description` passam a ser
-- opcionais (NULLIF), coerente com o CHECK adicionado na 0172
-- (tuss_code IS NOT NULL OR material_id IS NOT NULL OR material_name IS NOT NULL).

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

  -- Feature 045: materiais podem vir do catálogo (material_id), livres
  -- (material_name) ou por TUSS — com snapshot de custo (unit_cost_cents).
  -- Os triggers da 0172 validam tenant do material_id, tabela TUSS 19 e o
  -- CHECK de "ao menos um identificador".
  IF p_materials IS NOT NULL AND jsonb_typeof(p_materials) = 'array'
     AND jsonb_array_length(p_materials) > 0 THEN
    INSERT INTO public.appointment_materials (
      tenant_id, appointment_id, tuss_code, tuss_description, material_id,
      material_name, quantity, unit_cost_cents, created_by
    )
    SELECT
      p_tenant_id,
      v_appointment_id,
      NULLIF(item->>'tuss_code', '')::text,
      NULLIF(item->>'tuss_description', '')::text,
      NULLIF(item->>'material_id', '')::uuid,
      NULLIF(item->>'material_name', '')::text,
      COALESCE((item->>'quantity')::int, 1),
      COALESCE((item->>'unit_cost_cents')::int, 0),
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

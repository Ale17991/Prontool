-- 0081 — Quantidade por linha de appointment_procedures.
--
-- Cada linha de procedimento ganha `quantity INTEGER NOT NULL DEFAULT 1
-- CHECK (quantity > 0)`. `line_amount_cents` continua sendo o valor
-- UNITARIO; o total do atendimento e SUM(line_amount_cents * quantity).
--
-- Decisoes:
--   1. Default 1 + backfill implicito: linhas existentes ficam com
--      quantity=1, preservando o comportamento atual (total = soma de
--      line_amount_cents). Nenhum reporte muda para dados pre-existentes.
--   2. CHECK > 0 (mesma semantica de appointment_materials.quantity de
--      0061) — quantidade zero significaria "linha sem efeito", melhor
--      remover a linha do que persisti-la.
--   3. RPC `create_appointment_with_procedures_and_materials` reescrita
--      pra:
--        - Aceitar `quantity` no JSON (default 1 quando ausente — clientes
--          legados continuam funcionando).
--        - Somar pra v_total_cents com a multiplicacao por quantidade.
--        - INSERT em appointment_procedures com a coluna nova.
--      Mesma assinatura: PostgreSQL identifica funcao por (nome, tipos)
--      e os tipos nao mudaram, entao callers existentes (TS) nao quebram.

-- ==========================================================================
-- (a) Coluna quantity (+ check)
-- ==========================================================================
ALTER TABLE public.appointment_procedures
  ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'appointment_procedures_quantity_check'
      AND conrelid = 'public.appointment_procedures'::regclass
  ) THEN
    ALTER TABLE public.appointment_procedures
      ADD CONSTRAINT appointment_procedures_quantity_check
      CHECK (quantity > 0);
  END IF;
END $$;

COMMENT ON COLUMN public.appointment_procedures.quantity IS
  'Multiplicador da linha. line_amount_cents e UNITARIO; total = line_amount_cents * quantity. Default 1 para preservar atendimentos backfilled.';

-- ==========================================================================
-- (b) Reescreve a RPC pra incluir `quantity` no INSERT e no calculo do total.
--     Mesma assinatura — PostgreSQL nao trata como nova funcao.
-- ==========================================================================
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
  IF v_jwt_tenant IS NOT NULL AND v_jwt_tenant <> p_tenant_id THEN
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

  IF v_total_cents <= 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'PROCEDURES_TOTAL_ZERO', ERRCODE = '22023';
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

  -- Insere todas as linhas com quantity (default 1 quando ausente).
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

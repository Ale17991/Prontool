-- 0069 — Feature: Multiplos procedimentos por atendimento.
--
-- Atendimento passa de 1:1 com procedures (UMA linha = UM procedimento) para
-- 1:N. Cada linha pode ter seu proprio plano (inclusive particular), seu
-- proprio source_price_version_id e seu proprio valor congelado.
--
-- Decisoes:
--   1. appointments.procedure_id, plan_id, source_price_version_id continuam
--      existindo — armazenam a "linha primaria" (sequence=1). Preserva:
--        - Calendario/lista que mostram um nome curto
--        - Auto-link FIFO em treatment_plan_steps (que casa por procedure_id)
--        - Trigger enforce_appointment_preconditions (valida a linha primaria)
--   2. appointments.frozen_amount_cents = SUM(line_amount_cents) — definido
--      no INSERT pelo RPC, NUNCA atualizado depois (appointments e append-only).
--   3. Para anexar procedimentos depois de criar, criamos RPC SECURITY DEFINER
--      attach_procedures_to_appointment que faz INSERT em appointment_procedures
--      + UPDATE em appointments.frozen_amount_cents bypass-ando o append-only
--      (current_user = postgres dentro da SECURITY DEFINER funcao).
--   4. Tabela appointment_procedures e append-only para authenticated (UPDATE/
--      DELETE bloqueados). Mutacao soh via RPC SECURITY DEFINER.
--   5. Triggers em appointment_procedures: append-only, tenant_consistency,
--      tuss_vigente, price_version_check (mesma semantica de
--      enforce_appointment_preconditions), audit.
--   6. Backfill: cada appointment existente vira UMA linha com sequence=1,
--      line_amount_cents = appointments.frozen_amount_cents.

-- =========================================================================
-- (a) Tabela appointment_procedures
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.appointment_procedures (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  appointment_id              UUID NOT NULL REFERENCES public.appointments(id) ON DELETE RESTRICT,
  procedure_id                UUID NOT NULL REFERENCES public.procedures(id) ON DELETE RESTRICT,
  plan_id                     UUID NULL REFERENCES public.health_plans(id) ON DELETE RESTRICT,
  source_price_version_id     UUID NULL REFERENCES public.price_versions(id) ON DELETE RESTRICT,
  line_amount_cents           BIGINT NOT NULL CHECK (line_amount_cents >= 0),
  vigente_amount_cents        BIGINT NOT NULL CHECK (vigente_amount_cents >= 0),
  amount_was_overridden       BOOLEAN NOT NULL DEFAULT false,
  sequence                    INTEGER NOT NULL CHECK (sequence > 0),
  created_by                  UUID NOT NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (appointment_id, sequence)
);

CREATE INDEX IF NOT EXISTS appointment_procedures_appointment_idx
  ON public.appointment_procedures (appointment_id, sequence);

CREATE INDEX IF NOT EXISTS appointment_procedures_tenant_created_idx
  ON public.appointment_procedures (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS appointment_procedures_procedure_idx
  ON public.appointment_procedures (tenant_id, procedure_id);

CREATE INDEX IF NOT EXISTS appointment_procedures_plan_idx
  ON public.appointment_procedures (tenant_id, plan_id);

COMMENT ON TABLE public.appointment_procedures IS
  'Linhas de procedimentos de um atendimento (feature multi-procedimento). Append-only. A linha sequence=1 e denormalizada em appointments.procedure_id/plan_id/source_price_version_id.';

-- =========================================================================
-- (b) RLS — leitura por authenticated (tenant scoped); mutacao soh via RPC
-- =========================================================================
ALTER TABLE public.appointment_procedures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS appointment_procedures_read ON public.appointment_procedures;
CREATE POLICY appointment_procedures_read ON public.appointment_procedures
  FOR SELECT USING (tenant_id = public.jwt_tenant_id());

REVOKE INSERT, UPDATE, DELETE ON public.appointment_procedures FROM authenticated;
GRANT SELECT ON public.appointment_procedures TO authenticated;

-- =========================================================================
-- (c) Trigger: append-only enforcement
-- =========================================================================
CREATE OR REPLACE FUNCTION public.enforce_appointment_procedures_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role', 'supabase_auth_admin') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'appointment_procedures: append-only. UPDATE/DELETE not permitted.'
    USING ERRCODE = '42501';
END $$;

DROP TRIGGER IF EXISTS appointment_procedures_immutable ON public.appointment_procedures;
CREATE TRIGGER appointment_procedures_immutable
  BEFORE UPDATE OR DELETE ON public.appointment_procedures
  FOR EACH ROW EXECUTE FUNCTION public.enforce_appointment_procedures_mutation();

-- =========================================================================
-- (d) Trigger: tenant_id da linha deve casar com tenant_id do appointment
-- =========================================================================
CREATE OR REPLACE FUNCTION public.check_procedure_line_tenant_consistency()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_appointment_tenant UUID;
BEGIN
  SELECT tenant_id INTO v_appointment_tenant
    FROM public.appointments
   WHERE id = NEW.appointment_id;

  IF v_appointment_tenant IS NULL THEN
    RAISE EXCEPTION 'appointment_procedures: appointment % nao encontrado', NEW.appointment_id
      USING ERRCODE = '23503';
  END IF;

  IF NEW.tenant_id <> v_appointment_tenant THEN
    RAISE EXCEPTION 'PROCEDURE_LINE_TENANT_MISMATCH: linha.tenant_id (%) <> appointment.tenant_id (%)',
      NEW.tenant_id, v_appointment_tenant
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS appointment_procedures_tenant_consistency ON public.appointment_procedures;
CREATE TRIGGER appointment_procedures_tenant_consistency
  BEFORE INSERT ON public.appointment_procedures
  FOR EACH ROW EXECUTE FUNCTION public.check_procedure_line_tenant_consistency();

-- =========================================================================
-- (e) Trigger: procedure_id deve pertencer ao tenant + TUSS vigente
-- =========================================================================
CREATE OR REPLACE FUNCTION public.check_procedure_line_tuss_vigente()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_tuss_code TEXT;
  v_valid_to DATE;
  v_appointment_at TIMESTAMPTZ;
BEGIN
  SELECT p.tuss_code INTO v_tuss_code
    FROM public.procedures p
   WHERE p.id = NEW.procedure_id AND p.tenant_id = NEW.tenant_id;

  IF v_tuss_code IS NULL THEN
    RAISE EXCEPTION 'PROCEDURE_LINE_UNKNOWN: procedure % nao encontrado no tenant', NEW.procedure_id
      USING ERRCODE = '23514';
  END IF;

  SELECT a.appointment_at INTO v_appointment_at
    FROM public.appointments a
   WHERE a.id = NEW.appointment_id;

  SELECT valid_to INTO v_valid_to
    FROM public.tuss_codes WHERE code = v_tuss_code;

  IF v_valid_to IS NOT NULL
     AND v_valid_to < (v_appointment_at AT TIME ZONE 'UTC')::date THEN
    RAISE EXCEPTION 'PROCEDURE_LINE_TUSS_RETIRED: TUSS % retirado em %', v_tuss_code, v_valid_to
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS appointment_procedures_tuss_guard ON public.appointment_procedures;
CREATE TRIGGER appointment_procedures_tuss_guard
  BEFORE INSERT ON public.appointment_procedures
  FOR EACH ROW EXECUTE FUNCTION public.check_procedure_line_tuss_vigente();

-- =========================================================================
-- (f) Trigger: price_version coerencia (mesma semantica de enforce_appointment_preconditions)
--     - Se plan_id NOT NULL: source_price_version_id deve referenciar uma
--       price_versions vigente para (tenant, procedure, plan).
--     - Se plan_id IS NULL (particular): source_price_version_id deve ser NULL.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.check_procedure_line_price_coherence()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_appointment_at TIMESTAMPTZ;
  v_price_match UUID;
BEGIN
  IF NEW.plan_id IS NULL THEN
    IF NEW.source_price_version_id IS NOT NULL THEN
      RAISE EXCEPTION 'PROCEDURE_LINE_PARTICULAR_NO_PRICE_VERSION: linha particular nao deve referenciar price_version'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  SELECT a.appointment_at INTO v_appointment_at
    FROM public.appointments a
   WHERE a.id = NEW.appointment_id;

  SELECT pv.id INTO v_price_match
    FROM public.price_versions pv
   WHERE pv.tenant_id = NEW.tenant_id
     AND pv.procedure_id = NEW.procedure_id
     AND pv.plan_id = NEW.plan_id
     AND pv.valid_from <= (v_appointment_at AT TIME ZONE 'UTC')::date
   ORDER BY pv.valid_from DESC, pv.created_at DESC
   LIMIT 1;

  IF v_price_match IS NULL THEN
    RAISE EXCEPTION 'PROCEDURE_LINE_PRICE_MISSING: sem price_version vigente para (tenant=%, procedure=%, plan=%) na data do atendimento',
      NEW.tenant_id, NEW.procedure_id, NEW.plan_id
      USING ERRCODE = '23514';
  END IF;

  -- Se o caller nao informou, preenche com o vigente.
  IF NEW.source_price_version_id IS NULL THEN
    NEW.source_price_version_id := v_price_match;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS appointment_procedures_price_coherence ON public.appointment_procedures;
CREATE TRIGGER appointment_procedures_price_coherence
  BEFORE INSERT ON public.appointment_procedures
  FOR EACH ROW EXECUTE FUNCTION public.check_procedure_line_price_coherence();

-- =========================================================================
-- (g) Trigger: audit_log no INSERT
-- =========================================================================
CREATE OR REPLACE FUNCTION public.audit_appointment_procedure_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.log_audit_event(
    NEW.tenant_id,
    'appointment_procedures',
    NEW.id,
    'created',
    NULL,
    json_build_object(
      'appointment_id',          NEW.appointment_id,
      'procedure_id',            NEW.procedure_id,
      'plan_id',                 NEW.plan_id,
      'source_price_version_id', NEW.source_price_version_id,
      'line_amount_cents',       NEW.line_amount_cents,
      'vigente_amount_cents',    NEW.vigente_amount_cents,
      'amount_was_overridden',   NEW.amount_was_overridden,
      'sequence',                NEW.sequence,
      'created_by',              NEW.created_by
    )::text,
    'feature multi-procedimento — linha adicionada ao atendimento'
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS appointment_procedures_audit ON public.appointment_procedures;
CREATE TRIGGER appointment_procedures_audit
  AFTER INSERT ON public.appointment_procedures
  FOR EACH ROW EXECUTE FUNCTION public.audit_appointment_procedure_insert();

-- =========================================================================
-- (h) RPC: create_appointment_with_procedures_and_materials
--     Cria UM appointment + N linhas de procedimento + M materiais em
--     transacao implicita (PostgreSQL).
--
--     Recebe a lista de procedimentos como JSONB com os campos:
--       - procedure_id (uuid)
--       - plan_id (uuid|null)
--       - source_price_version_id (uuid|null)
--       - line_amount_cents (integer)
--       - vigente_amount_cents (integer)
--       - amount_was_overridden (boolean)
--       - sequence (integer >= 1, unico no array)
--
--     A linha sequence=1 e denormalizada em appointments.procedure_id/
--     plan_id/source_price_version_id. frozen_amount_cents = soma de
--     line_amount_cents.
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
  IF v_jwt_tenant IS NOT NULL AND v_jwt_tenant <> p_tenant_id THEN
    RAISE EXCEPTION USING MESSAGE = 'TENANT_MISMATCH', ERRCODE = '42501';
  END IF;

  IF p_procedures IS NULL OR jsonb_typeof(p_procedures) <> 'array'
     OR jsonb_array_length(p_procedures) = 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'PROCEDURES_REQUIRED', ERRCODE = '22023';
  END IF;

  -- Soma e linha primaria
  SELECT
    COALESCE(SUM((item->>'line_amount_cents')::bigint), 0),
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

  -- Insere appointment (linha primaria denormalizada).
  -- p_source_raw_event_id ativa o unique index (tenant_id, source_raw_event_id)
  -- garantindo idempotencia do path GHL (webhook delivery duplicado nao gera
  -- atendimento duplicado).
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

  -- Insere todas as linhas
  INSERT INTO public.appointment_procedures (
    tenant_id, appointment_id, procedure_id, plan_id, source_price_version_id,
    line_amount_cents, vigente_amount_cents, amount_was_overridden, sequence, created_by
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
    p_actor
  FROM jsonb_array_elements(p_procedures) AS item;

  -- Materiais opcionais
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

GRANT EXECUTE ON FUNCTION public.create_appointment_with_procedures_and_materials(
  UUID, UUID, UUID, TIMESTAMPTZ, INTEGER, TEXT, TEXT, UUID, JSONB, INTEGER, UUID, JSONB, UUID
) TO authenticated;

-- =========================================================================
-- (i) Backfill: copia procedure_id/plan_id/source_price_version_id de
--     appointments existentes para appointment_procedures (sequence=1,
--     line_amount_cents = appointments.frozen_amount_cents,
--     vigente_amount_cents = mesma coisa,
--     amount_was_overridden = false).
--     Pula triggers de validacao usando SET LOCAL session_replication_role
--     para acelerar (apenas dados ja consistentes).
-- =========================================================================
DO $$
DECLARE
  v_inserted INTEGER := 0;
  v_sentinel UUID := '00000000-0000-0000-0000-000000000001';
BEGIN
  -- Pula triggers BEFORE INSERT — backfill em massa de dados ja validados.
  -- O trigger AFTER (audit) tambem nao roda; pulamos audit de backfill
  -- intencionalmente para evitar 1 linha de log por atendimento legado.
  SET LOCAL session_replication_role = replica;

  INSERT INTO public.appointment_procedures (
    id, tenant_id, appointment_id, procedure_id, plan_id, source_price_version_id,
    line_amount_cents, vigente_amount_cents, amount_was_overridden, sequence,
    created_by, created_at
  )
  SELECT
    gen_random_uuid(),
    a.tenant_id,
    a.id,
    a.procedure_id,
    a.plan_id,
    a.source_price_version_id,
    a.frozen_amount_cents,
    a.frozen_amount_cents,
    false,
    1,
    v_sentinel,
    a.created_at
  FROM public.appointments a
  WHERE NOT EXISTS (
    SELECT 1 FROM public.appointment_procedures ap
    WHERE ap.appointment_id = a.id AND ap.sequence = 1
  );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RAISE NOTICE '[0069 backfill] appointment_procedures: % linhas inseridas (sequence=1)', v_inserted;
END $$;

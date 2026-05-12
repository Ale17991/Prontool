-- 0070 — Atendimento com procedimento "nao listado" (is_unlisted=true).
--
-- Bug observado: criar atendimento com procedimento is_unlisted=true e
-- plano de saude resultava em "TUSS_CODE_UNKNOWN" / "PROCEDURE_LINE_UNKNOWN"
-- porque os triggers buscavam tuss_code para validar contra tuss_codes,
-- e tuss_code e NULL para procedimentos nao listados (constraint da 0066).
--
-- Migration 0067 ja permite covered_by_plan=true para unlisted (pacotes
-- negociados), mas faltava ajustar os triggers de validacao de
-- pre-condicoes na criacao de atendimento.
--
-- Fix: triggers SKIPam validacao TUSS quando procedures.is_unlisted=true.
-- Trigger de price_version tambem aceita source_price_version_id=NULL
-- com plan_id NOT NULL quando unlisted — o preco vem de
-- default_amount_cents (sugestao) ou override manual.

-- =========================================================================
-- (a) enforce_appointment_preconditions (appointments BEFORE INSERT)
--     Skipa validacao TUSS quando procedure.is_unlisted=true.
--     Skipa validacao de price_version quando procedure.is_unlisted=true
--     (pacotes negociados podem nao ter price_version cadastrada; valor
--     vem de default_amount_cents/override).
-- =========================================================================
CREATE OR REPLACE FUNCTION public.enforce_appointment_preconditions()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  proc_tuss     TEXT;
  proc_unlisted BOOLEAN;
  tuss_valid_to DATE;
  active_price  UUID;
BEGIN
  -- Carrega tuss_code + is_unlisted do procedimento da linha primaria.
  SELECT p.tuss_code, p.is_unlisted INTO proc_tuss, proc_unlisted
  FROM public.procedures p
  WHERE p.id = NEW.procedure_id AND p.tenant_id = NEW.tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'APPOINTMENT_PROCEDURE_UNKNOWN: procedimento nao encontrado neste tenant'
      USING ERRCODE = '23514';
  END IF;

  -- Procedimento nao listado: pula validacao de TUSS + price_version.
  IF proc_unlisted THEN
    -- Coerencia minima: particular tem source_price_version_id=NULL.
    IF NEW.plan_id IS NULL AND NEW.source_price_version_id IS NOT NULL THEN
      RAISE EXCEPTION 'APPOINTMENT_PARTICULAR_NO_PRICE_VERSION: linha particular nao deve referenciar price_version'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  -- Procedimento listado: tuss_code obrigatorio (constraint da 0066 garante,
  -- defesa redundante aqui).
  IF proc_tuss IS NULL THEN
    RAISE EXCEPTION 'APPOINTMENT_PROCEDURE_UNKNOWN: procedimento listado sem codigo TUSS (estado inconsistente)'
      USING ERRCODE = '23514';
  END IF;

  -- TUSS deve estar vigente.
  SELECT valid_to INTO tuss_valid_to
  FROM public.tuss_codes WHERE code = proc_tuss;

  IF tuss_valid_to IS NOT NULL
     AND tuss_valid_to < (NEW.appointment_at AT TIME ZONE 'UTC')::date THEN
    RAISE EXCEPTION 'TUSS_CODE_RETIRED: codigo % retirado em %', proc_tuss, tuss_valid_to
      USING ERRCODE = '23514';
  END IF;

  -- Plano informado: requer price_version vigente.
  IF NEW.plan_id IS NOT NULL THEN
    SELECT id INTO active_price
    FROM public.price_versions
    WHERE tenant_id = NEW.tenant_id
      AND procedure_id = NEW.procedure_id
      AND plan_id = NEW.plan_id
      AND valid_from <= (NEW.appointment_at AT TIME ZONE 'UTC')::date
    ORDER BY valid_from DESC, created_at DESC
    LIMIT 1;

    IF active_price IS NULL THEN
      RAISE EXCEPTION 'APPOINTMENT_PRICE_MISSING: nenhum preco vigente para esta combinacao de procedimento e plano na data do atendimento'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.source_price_version_id IS NULL THEN
      NEW.source_price_version_id := active_price;
    END IF;
  ELSE
    -- Particular: source_price_version_id deve ser NULL.
    IF NEW.source_price_version_id IS NOT NULL THEN
      RAISE EXCEPTION 'APPOINTMENT_PARTICULAR_NO_PRICE_VERSION: linha particular nao deve referenciar price_version'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END $$;

-- =========================================================================
-- (b) check_procedure_line_tuss_vigente (appointment_procedures BEFORE INSERT)
--     Skipa validacao TUSS quando procedure.is_unlisted=true.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.check_procedure_line_tuss_vigente()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_tuss_code      TEXT;
  v_unlisted       BOOLEAN;
  v_valid_to       DATE;
  v_appointment_at TIMESTAMPTZ;
BEGIN
  SELECT p.tuss_code, p.is_unlisted INTO v_tuss_code, v_unlisted
    FROM public.procedures p
   WHERE p.id = NEW.procedure_id AND p.tenant_id = NEW.tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROCEDURE_LINE_UNKNOWN: procedimento nao encontrado neste tenant'
      USING ERRCODE = '23514';
  END IF;

  -- Procedimento nao listado: pula validacao TUSS.
  IF v_unlisted THEN
    RETURN NEW;
  END IF;

  IF v_tuss_code IS NULL THEN
    RAISE EXCEPTION 'PROCEDURE_LINE_UNKNOWN: procedimento listado sem codigo TUSS (estado inconsistente)'
      USING ERRCODE = '23514';
  END IF;

  SELECT a.appointment_at INTO v_appointment_at
    FROM public.appointments a
   WHERE a.id = NEW.appointment_id;

  SELECT valid_to INTO v_valid_to
    FROM public.tuss_codes WHERE code = v_tuss_code;

  IF v_valid_to IS NOT NULL
     AND v_valid_to < (v_appointment_at AT TIME ZONE 'UTC')::date THEN
    RAISE EXCEPTION 'PROCEDURE_LINE_TUSS_RETIRED: codigo TUSS % retirado em %', v_tuss_code, v_valid_to
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END $$;

-- =========================================================================
-- (c) check_procedure_line_price_coherence (appointment_procedures BEFORE INSERT)
--     Quando procedure.is_unlisted=true: aceita plan_id NOT NULL com
--     source_price_version_id NULL (pacote sem price_version cadastrada).
--     Quando price_version existe, ainda preenche o source.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.check_procedure_line_price_coherence()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_unlisted       BOOLEAN;
  v_appointment_at TIMESTAMPTZ;
  v_price_match    UUID;
BEGIN
  SELECT p.is_unlisted INTO v_unlisted
    FROM public.procedures p
   WHERE p.id = NEW.procedure_id;

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
    -- Procedimento nao listado pode nao ter price_version (pacote
    -- negociado, valor vai pelo default_amount_cents ou override).
    -- Procedimento listado SEM price_version e erro.
    IF v_unlisted THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'PROCEDURE_LINE_PRICE_MISSING: nenhum preco vigente para esta combinacao de procedimento e plano na data do atendimento'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.source_price_version_id IS NULL THEN
    NEW.source_price_version_id := v_price_match;
  END IF;

  RETURN NEW;
END $$;

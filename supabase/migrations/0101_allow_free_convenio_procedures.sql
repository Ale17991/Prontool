-- 0101 — Procedimento gratuito em convenio passa a ser permitido.
--
-- Antes: os triggers enforce_appointment_preconditions (0059) e
-- check_procedure_line_price_coherence (0069) exigiam uma linha em
-- price_versions sempre que plan_id IS NOT NULL — mesmo quando o
-- atendimento/linha esta com valor zero (clinica nao cobra do paciente
-- nem do convenio).
--
-- Caso real: clinica oferece consulta gratuita por convenio (ex.: 1a
-- avaliacao, programa social, cortesia) mas precisa registrar o
-- atendimento. Hoje recebe:
--   "Nenhum preço vigente cadastrado para essa combinação..."
-- e nao consegue salvar sem inflar valor artificialmente.
--
-- Fix: ambos os triggers passam a pular a checagem de price_versions
-- quando o valor congelado e' zero. Continua exigindo price_version
-- vigente quando ha cobranca (frozen_amount_cents > 0 ou
-- line_amount_cents > 0).
--
-- Idempotente — CREATE OR REPLACE em ambas as funcoes.

-- =========================================================================
-- (a) enforce_appointment_preconditions — pula price_version se valor=0
-- =========================================================================
CREATE OR REPLACE FUNCTION public.enforce_appointment_preconditions()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  proc_tuss TEXT;
  tuss_valid_to DATE;
  active_price UUID;
BEGIN
  -- TUSS check (sempre obrigatorio)
  SELECT p.tuss_code INTO proc_tuss
  FROM public.procedures p
  WHERE p.id = NEW.procedure_id AND p.tenant_id = NEW.tenant_id;

  IF proc_tuss IS NULL THEN
    RAISE EXCEPTION 'APPOINTMENT_PROCEDURE_UNKNOWN: procedure not found in tenant'
      USING ERRCODE = '23514';
  END IF;

  SELECT valid_to INTO tuss_valid_to
  FROM public.tuss_codes WHERE code = proc_tuss;

  IF tuss_valid_to IS NOT NULL
     AND tuss_valid_to < (NEW.appointment_at AT TIME ZONE 'UTC')::date THEN
    RAISE EXCEPTION 'TUSS_CODE_RETIRED: code=% was retired on %', proc_tuss, tuss_valid_to
      USING ERRCODE = '23514';
  END IF;

  -- Price-version check: somente em convenio (plan_id NOT NULL) E
  -- quando ha cobranca (frozen_amount_cents > 0). Atendimento gratuito
  -- em convenio (cortesia, programa social, 1a avaliacao) passa sem
  -- exigir price_version.
  IF NEW.plan_id IS NOT NULL AND NEW.frozen_amount_cents > 0 THEN
    SELECT id INTO active_price
    FROM public.price_versions
    WHERE tenant_id = NEW.tenant_id
      AND procedure_id = NEW.procedure_id
      AND plan_id = NEW.plan_id
      AND valid_from <= (NEW.appointment_at AT TIME ZONE 'UTC')::date
    ORDER BY valid_from DESC, created_at DESC
    LIMIT 1;

    IF active_price IS NULL THEN
      RAISE EXCEPTION 'APPOINTMENT_PRICE_MISSING: no active price for (procedure, plan) on appointment date'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.source_price_version_id IS NULL THEN
      NEW.source_price_version_id := active_price;
    END IF;
  ELSIF NEW.plan_id IS NULL THEN
    -- Particular: source_price_version_id deve ser NULL.
    IF NEW.source_price_version_id IS NOT NULL THEN
      RAISE EXCEPTION 'APPOINTMENT_PARTICULAR_NO_PRICE_VERSION: plan_id is null but source_price_version_id was provided'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  -- Convenio com valor zero: nao mexe em source_price_version_id (NULL ok).

  RETURN NEW;
END $$;

-- =========================================================================
-- (b) check_procedure_line_price_coherence — pula price_version se valor=0
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

  -- Linha em convenio com valor zero (cortesia): pula price_version.
  IF NEW.line_amount_cents = 0 THEN
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

  IF NEW.source_price_version_id IS NULL THEN
    NEW.source_price_version_id := v_price_match;
  END IF;

  RETURN NEW;
END $$;

NOTIFY pgrst, 'reload schema';

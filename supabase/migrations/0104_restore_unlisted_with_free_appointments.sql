-- 0104 — Restaura suporte a procedimento "nao listado" em atendimento
-- com plano, sem perder o suporte a atendimento gratuito (regressao
-- introduzida pela 0101).
--
-- Cronologia:
--   - 0070 ajustou enforce_appointment_preconditions e
--     check_procedure_line_price_coherence para pular TUSS/price_version
--     quando procedures.is_unlisted=true (pacote negociado sem TUSS).
--   - 0101 reescreveu OS MESMOS triggers focando so' em gratuidade
--     (frozen_amount_cents=0 / line_amount_cents=0), e removeu
--     acidentalmente o tratamento de is_unlisted introduzido em 0070.
--
-- Sintoma em producao: criar atendimento com procedimento unlisted +
-- plano resulta em "APPOINTMENT_PROCEDURE_UNKNOWN" -> "Procedimento
-- nao encontrado neste tenant" porque proc.tuss_code IS NULL faz o
-- trigger entrar no branch de erro.
--
-- Fix: reescreve ambos os triggers combinando AS DUAS regras:
--   1) is_unlisted=true: pula validacao de TUSS e price_version
--      (mesmo com cobranca, vai por default_amount_cents/override).
--   2) line_amount=0/frozen=0: pula price_version (mantem 0101).
--
-- Idempotente — CREATE OR REPLACE em ambas as funcoes.

-- =========================================================================
-- (a) enforce_appointment_preconditions
--     Combina os dois casos: unlisted + gratuidade.
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
    RAISE EXCEPTION 'APPOINTMENT_PROCEDURE_UNKNOWN: procedimento nao encontrado nesta clinica'
      USING ERRCODE = '23514';
  END IF;

  -- Procedimento nao listado: pula TUSS e price_version (pacote
  -- negociado, valor vai por default_amount_cents ou override).
  -- Coerencia minima: linha particular ainda nao deve referenciar
  -- price_version (defesa redundante ao trigger de linha).
  IF proc_unlisted THEN
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

  -- TUSS vigente.
  SELECT valid_to INTO tuss_valid_to
  FROM public.tuss_codes WHERE code = proc_tuss;

  IF tuss_valid_to IS NOT NULL
     AND tuss_valid_to < (NEW.appointment_at AT TIME ZONE 'UTC')::date THEN
    RAISE EXCEPTION 'TUSS_CODE_RETIRED: codigo % retirado em %', proc_tuss, tuss_valid_to
      USING ERRCODE = '23514';
  END IF;

  -- Price-version: exige somente em convenio (plan_id NOT NULL) E
  -- quando ha cobranca (frozen_amount_cents > 0). Atendimento gratuito
  -- em convenio (cortesia, 1a avaliacao, programa social) passa sem
  -- exigir price_version (regra da 0101 preservada).
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
      RAISE EXCEPTION 'APPOINTMENT_PRICE_MISSING: nenhum preco vigente para esta combinacao de procedimento e plano na data do atendimento'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.source_price_version_id IS NULL THEN
      NEW.source_price_version_id := active_price;
    END IF;
  ELSIF NEW.plan_id IS NULL THEN
    -- Particular: source_price_version_id deve ser NULL.
    IF NEW.source_price_version_id IS NOT NULL THEN
      RAISE EXCEPTION 'APPOINTMENT_PARTICULAR_NO_PRICE_VERSION: linha particular nao deve referenciar price_version'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  -- Convenio com valor zero: nao mexe em source_price_version_id (NULL ok).

  RETURN NEW;
END $$;

-- =========================================================================
-- (b) check_procedure_line_price_coherence
--     Combina os dois casos: unlisted + gratuidade na linha.
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

  -- Linha em convenio com valor zero (cortesia/programa social):
  -- pula price_version (regra da 0101 preservada).
  IF NEW.line_amount_cents = 0 THEN
    RETURN NEW;
  END IF;

  -- Linha em convenio com valor > 0, mas procedimento NAO LISTADO:
  -- nao exige price_version (pacote negociado, vai por
  -- default_amount_cents/override — regra da 0070 restaurada).
  IF v_unlisted THEN
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
    RAISE EXCEPTION 'PROCEDURE_LINE_PRICE_MISSING: sem price_version vigente para (clinica=%, procedure=%, plan=%) na data do atendimento',
      NEW.tenant_id, NEW.procedure_id, NEW.plan_id
      USING ERRCODE = '23514';
  END IF;

  IF NEW.source_price_version_id IS NULL THEN
    NEW.source_price_version_id := v_price_match;
  END IF;

  RETURN NEW;
END $$;

NOTIFY pgrst, 'reload schema';

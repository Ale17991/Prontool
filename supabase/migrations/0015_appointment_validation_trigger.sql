-- T027: Guard appointment INSERT (FR-015, FR-016).
-- (a) an active price_versions row MUST exist for (tenant, proc, plan) on
--     the appointment date — otherwise APPOINTMENT_PRICE_MISSING.
-- (b) the procedure's tuss_code MUST still be valid (valid_to IS NULL) —
--     otherwise TUSS_CODE_RETIRED. This catches cases where the code was
--     retired between procedure creation and appointment.

CREATE OR REPLACE FUNCTION public.enforce_appointment_preconditions()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  proc_tuss TEXT;
  tuss_valid_to DATE;
  active_price UUID;
BEGIN
  -- (b) TUSS still active
  SELECT p.tuss_code INTO proc_tuss
  FROM public.procedures p
  WHERE p.id = NEW.procedure_id AND p.tenant_id = NEW.tenant_id;

  IF proc_tuss IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'APPOINTMENT_PROCEDURE_UNKNOWN: procedure not found in tenant',
      ERRCODE = '23514';
  END IF;

  SELECT valid_to INTO tuss_valid_to
  FROM public.tuss_codes
  WHERE code = proc_tuss;

  IF tuss_valid_to IS NOT NULL AND tuss_valid_to < (NEW.appointment_at AT TIME ZONE 'UTC')::date THEN
    RAISE EXCEPTION USING
      MESSAGE = format('TUSS_CODE_RETIRED: code=% was retired on %', proc_tuss, tuss_valid_to),
      ERRCODE = '23514';
  END IF;

  -- (a) Active price version exists on appointment date
  SELECT id INTO active_price
  FROM public.price_versions
  WHERE tenant_id = NEW.tenant_id
    AND procedure_id = NEW.procedure_id
    AND plan_id = NEW.plan_id
    AND valid_from <= (NEW.appointment_at AT TIME ZONE 'UTC')::date
  ORDER BY valid_from DESC, created_at DESC
  LIMIT 1;

  IF active_price IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'APPOINTMENT_PRICE_MISSING: no active price for (procedure, plan) on appointment date',
      ERRCODE = '23514';
  END IF;

  -- If caller didn't populate source_price_version_id, fill it in.
  IF NEW.source_price_version_id IS NULL THEN
    NEW.source_price_version_id := active_price;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS appointments_validate ON public.appointments;
CREATE TRIGGER appointments_validate
  BEFORE INSERT ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_appointment_preconditions();

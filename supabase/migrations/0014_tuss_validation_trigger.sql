-- T026: Validate tuss_code on procedure INSERT against the global catalog.
-- Principle IV: code MUST exist in tuss_codes AND be currently valid.

CREATE OR REPLACE FUNCTION public.enforce_tuss_code_active_on_procedure()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  hit RECORD;
BEGIN
  SELECT code, valid_to INTO hit
  FROM public.tuss_codes
  WHERE code = NEW.tuss_code;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      MESSAGE = format('TUSS_CODE_UNKNOWN: code=% not found in catalog', NEW.tuss_code),
      ERRCODE = '23514';
  END IF;

  IF hit.valid_to IS NOT NULL AND hit.valid_to < CURRENT_DATE THEN
    RAISE EXCEPTION USING
      MESSAGE = format('TUSS_CODE_RETIRED: code=% was retired on %', NEW.tuss_code, hit.valid_to),
      ERRCODE = '23514';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS procedures_validate_tuss ON public.procedures;
CREATE TRIGGER procedures_validate_tuss
  BEFORE INSERT ON public.procedures
  FOR EACH ROW EXECUTE FUNCTION public.enforce_tuss_code_active_on_procedure();

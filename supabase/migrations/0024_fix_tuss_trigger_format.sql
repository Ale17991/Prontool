-- 0014 usou `format('%', value)` em vez de `%s`, fazendo o trigger
-- explodir com "unrecognized format() type specifier" antes de a
-- mensagem TUSS_CODE_UNKNOWN/_RETIRED ser construída. Resultado: o
-- handler recebe um erro genérico e devolve 500. Corrigindo os
-- specifiers e o ERRCODE para um SQLSTATE apropriado (23514 é um
-- check_violation; usamos P0001/raise_exception padrão pra que o
-- handler diferencie pelo prefixo da mensagem).

CREATE OR REPLACE FUNCTION public.enforce_tuss_code_active_on_procedure()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  hit RECORD;
BEGIN
  SELECT code, valid_to INTO hit
  FROM public.tuss_codes
  WHERE code = NEW.tuss_code;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TUSS_CODE_UNKNOWN: code=% not found in catalog', NEW.tuss_code;
  END IF;

  IF hit.valid_to IS NOT NULL AND hit.valid_to < CURRENT_DATE THEN
    RAISE EXCEPTION 'TUSS_CODE_RETIRED: code=% was retired on %', NEW.tuss_code, hit.valid_to;
  END IF;

  RETURN NEW;
END $$;

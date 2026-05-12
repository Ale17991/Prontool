-- 0073 — procedures.custom_code_id FK → custom_procedure_codes.
--
-- Liga um procedimento "nao listado" (is_unlisted=true) a um codigo
-- personalizado da clinica (registry em custom_procedure_codes).
--
-- Regras:
--   - custom_code_id pode ser NULL (compatibilidade — unlisted sem codigo).
--   - Quando NOT NULL, exige is_unlisted=true (codigos personalizados sao
--     do dominio unlisted; procedimentos TUSS-coded usam o tuss_code).
--   - Tenant consistency garantida por trigger (o codigo deve pertencer ao
--     mesmo tenant do procedimento).

ALTER TABLE public.procedures
  ADD COLUMN IF NOT EXISTS custom_code_id UUID NULL
    REFERENCES public.custom_procedure_codes(id) ON DELETE RESTRICT;

-- custom_code_id IS NOT NULL implica is_unlisted=true
ALTER TABLE public.procedures
  DROP CONSTRAINT IF EXISTS procedures_custom_code_only_when_unlisted;
ALTER TABLE public.procedures
  ADD CONSTRAINT procedures_custom_code_only_when_unlisted
  CHECK (custom_code_id IS NULL OR is_unlisted = true);

-- Trigger: tenant consistency entre procedures e custom_procedure_codes.
CREATE OR REPLACE FUNCTION public.check_procedure_custom_code_tenant()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_code_tenant UUID;
BEGIN
  IF NEW.custom_code_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT tenant_id INTO v_code_tenant
    FROM public.custom_procedure_codes
   WHERE id = NEW.custom_code_id;
  IF v_code_tenant IS NULL THEN
    RAISE EXCEPTION 'CUSTOM_CODE_NOT_FOUND: codigo personalizado nao existe'
      USING ERRCODE = '23503';
  END IF;
  IF v_code_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'CUSTOM_CODE_TENANT_MISMATCH: codigo personalizado pertence a outro tenant'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS procedures_custom_code_tenant_consistency
  ON public.procedures;
CREATE TRIGGER procedures_custom_code_tenant_consistency
  BEFORE INSERT OR UPDATE OF custom_code_id ON public.procedures
  FOR EACH ROW EXECUTE FUNCTION public.check_procedure_custom_code_tenant();

-- Indice util pra reverso "que procedimento usa este codigo?" e pra filtros
-- (typeahead nas telas de atendimento que diferencia TUSS vs personalizado).
CREATE INDEX IF NOT EXISTS procedures_custom_code_id_idx
  ON public.procedures (custom_code_id)
  WHERE custom_code_id IS NOT NULL;

COMMENT ON COLUMN public.procedures.custom_code_id IS
  'FK para custom_procedure_codes. Quando preenchido, is_unlisted=true. Mostra "Personalizado" na UI no lugar de "Nao listado".';

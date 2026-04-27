-- 0049 — Evolução clínica SOAP em clinical_records.
--
-- Adiciona o tipo 'evolucao' e duas colunas JSONB:
--   - soap_data: { subjective, objective, assessment, plan }
--   - assessment_cids: array [{ code, description }] vinculados à seção A
-- Texto SOAP é dado clínico (não PII de identificação) — fica em
-- plaintext JSONB pra simplificar listagem e busca futura.

ALTER TABLE public.clinical_records
  DROP CONSTRAINT IF EXISTS clinical_records_type_check;
ALTER TABLE public.clinical_records
  ADD CONSTRAINT clinical_records_type_check
  CHECK (type IN ('texto', 'arquivo', 'anamnese', 'evolucao'));

ALTER TABLE public.clinical_records
  ADD COLUMN IF NOT EXISTS soap_data JSONB,
  ADD COLUMN IF NOT EXISTS assessment_cids JSONB;

ALTER TABLE public.clinical_records
  DROP CONSTRAINT IF EXISTS clinical_records_content_shape_check;

ALTER TABLE public.clinical_records
  ADD CONSTRAINT clinical_records_content_shape_check CHECK (
    (type = 'texto'    AND content IS NOT NULL AND file_url IS NULL     AND file_name IS NULL AND anamnesis_data IS NULL AND soap_data IS NULL)
    OR
    (type = 'arquivo'  AND file_url IS NOT NULL AND file_name IS NOT NULL AND content IS NULL  AND anamnesis_data IS NULL AND soap_data IS NULL)
    OR
    (type = 'anamnese' AND anamnesis_data IS NOT NULL AND content IS NULL AND file_url IS NULL AND file_name IS NULL AND soap_data IS NULL)
    OR
    (type = 'evolucao' AND soap_data IS NOT NULL AND content IS NULL AND file_url IS NULL AND file_name IS NULL AND anamnesis_data IS NULL)
  );

NOTIFY pgrst, 'reload schema';

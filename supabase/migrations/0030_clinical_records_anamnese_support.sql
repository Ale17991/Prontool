-- Extensão de clinical_records para suportar anamnese estruturada.
-- Renomeado de "0029_clinical_records_update.sql" gerado pelo AI Studio
-- para evitar colisão com 0029_anamnesis_templates.sql. Esta migration
-- é idempotente com a anterior — pode rodar em qualquer ordem após 0025.

-- 1) Trocar o CHECK de `type` para incluir 'anamnese'.
ALTER TABLE public.clinical_records
  DROP CONSTRAINT IF EXISTS clinical_records_type_check;
ALTER TABLE public.clinical_records
  ADD CONSTRAINT clinical_records_type_check
  CHECK (type IN ('texto', 'arquivo', 'anamnese'));

-- 2) Coluna nova. JSONB para o snapshot das respostas + referência ao
--    template aplicado (template_id, template_version, responses).
ALTER TABLE public.clinical_records
  ADD COLUMN IF NOT EXISTS anamnesis_data JSONB;

-- 3) O CHECK composto original (0025) exige `content` para `type='texto'` e
--    `file_*` para `type='arquivo'`. Ele não cobre 'anamnese', então uma
--    INSERT com type='anamnese' falharia. Substituímos por versão com 3 ramos.
--    O nome auto-gerado pelo Postgres para o CHECK anônimo da 0025 é
--    `clinical_records_check` (padrão de $TABLE_check<n>). Se a nomeação
--    divergir em ambientes antigos, o DROP IF EXISTS cobre.
ALTER TABLE public.clinical_records
  DROP CONSTRAINT IF EXISTS clinical_records_check;

ALTER TABLE public.clinical_records
  ADD CONSTRAINT clinical_records_content_shape_check CHECK (
    (type = 'texto'    AND content IS NOT NULL AND file_url IS NULL     AND file_name IS NULL AND anamnesis_data IS NULL)
    OR
    (type = 'arquivo'  AND file_url IS NOT NULL AND file_name IS NOT NULL AND content IS NULL  AND anamnesis_data IS NULL)
    OR
    (type = 'anamnese' AND anamnesis_data IS NOT NULL AND content IS NULL AND file_url IS NULL AND file_name IS NULL)
  );

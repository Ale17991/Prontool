-- 0053 — Acrescenta duration_minutes em appointments (suporte ao calendario,
-- feature 004) e registra a versao oficial TUSS Tabela 22 v202501 como
-- referencia da reconciliacao odontologica.
--
-- Decisoes:
--   1. duration_minutes e NULLABLE - atendimentos pre-feature-004 ficam NULL
--      e a UI le com COALESCE(.., 30). Preserva Principio I (Imutabilidade
--      Financeira): nenhum UPDATE em registros existentes.
--   2. CHECK 5-480 cobre 99% dos casos clinicos sem permitir valor absurdo.
--   3. INSERT em tuss_catalog_versions e documental - nao acrescenta nem
--      retira nenhum codigo de tuss_codes. Investigacao previa (commit anterior
--      desta branch) confirmou que a Tabela 22 oficial v202501 NAO contem
--      codigos odontologicos com prefixo 88, e tem 370 codigos odonto vs 380
--      da fonte charlesfgarcia/tabelas-ans (atual). Nada falta para importar.

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS duration_minutes INTEGER NULL
    CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 5 AND 480);

COMMENT ON COLUMN public.appointments.duration_minutes IS
  'Duracao em minutos. NULL em registros pre-feature-004; cliente le com COALESCE(., 30). Range 5-480.';

INSERT INTO public.tuss_catalog_versions (source_ref, content_hash, code_count, notes)
SELECT
  'ans_official_202501',
  'sha256:reference-only-no-code-import',
  5964,
  'TUSS Tabela 22 oficial v202501 - referencia da reconciliacao odontologica (feature 004). 0 codigos importados; ver scripts/tuss-odonto-audit.ts.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.tuss_catalog_versions WHERE source_ref = 'ans_official_202501'
);

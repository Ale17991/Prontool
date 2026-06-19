-- 0141 — Modelos de texto reutilizáveis + parâmetros de impressão (backlog 3).
--
-- Modelos com placeholders ({{paciente.nome}}, {{data}}, {{cid}}, …) usados
-- para emitir atestados/declarações/receitas (fora da Memed). Papel e tamanho
-- de fonte configuráveis. Ao emitir, o documento (0140) guarda o papel/fonte
-- aplicados.
--
-- Próximo número livre. Aditiva e idempotente.

CREATE TABLE IF NOT EXISTS public.document_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  doc_type    TEXT NOT NULL DEFAULT 'atestado'
                CHECK (doc_type IN ('atestado', 'declaracao', 'receita', 'outro')),
  body        TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 8000),
  paper_size  TEXT NOT NULL DEFAULT 'A4' CHECK (paper_size IN ('A4', 'A5', 'LETTER')),
  font_size   INTEGER NOT NULL DEFAULT 11 CHECK (font_size BETWEEN 8 AND 18),
  created_by  UUID NOT NULL REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID NULL REFERENCES auth.users(id),
  deleted_at  TIMESTAMPTZ NULL,
  deleted_by  UUID NULL REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS document_templates_tenant_idx
  ON public.document_templates (tenant_id, doc_type)
  WHERE deleted_at IS NULL;

ALTER TABLE public.document_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS document_templates_read ON public.document_templates;
CREATE POLICY document_templates_read ON public.document_templates
  FOR SELECT USING (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS document_templates_write ON public.document_templates;
CREATE POLICY document_templates_write ON public.document_templates
  FOR ALL
  USING  (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN ('admin', 'profissional_saude'))
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN ('admin', 'profissional_saude'));

-- patient_documents: guarda papel/fonte aplicados + aceita doc_type 'receita'.
ALTER TABLE public.patient_documents
  ADD COLUMN IF NOT EXISTS paper_size TEXT NOT NULL DEFAULT 'A4',
  ADD COLUMN IF NOT EXISTS font_size INTEGER NOT NULL DEFAULT 11;

ALTER TABLE public.patient_documents
  DROP CONSTRAINT IF EXISTS patient_documents_doc_type_check;
ALTER TABLE public.patient_documents
  ADD CONSTRAINT patient_documents_doc_type_check
    CHECK (doc_type IN ('atestado', 'declaracao', 'receita', 'outro'));

COMMENT ON TABLE public.document_templates IS
  'Backlog 3 — modelos reutilizáveis com placeholders + papel/fonte configuráveis.';

NOTIFY pgrst, 'reload schema';

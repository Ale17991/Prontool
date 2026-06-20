-- 0143 — Tipo "laudo" para modelos e documentos (backlog 2/2).
--
-- Permite criar modelos de LAUDO de exame (impressão pré-estabelecida) e emitir
-- laudos pela ficha do paciente, reusando o motor de modelos (0141). Aditiva.

ALTER TABLE public.document_templates
  DROP CONSTRAINT IF EXISTS document_templates_doc_type_check;
ALTER TABLE public.document_templates
  ADD CONSTRAINT document_templates_doc_type_check
    CHECK (doc_type IN ('atestado', 'declaracao', 'receita', 'laudo', 'outro'));

ALTER TABLE public.patient_documents
  DROP CONSTRAINT IF EXISTS patient_documents_doc_type_check;
ALTER TABLE public.patient_documents
  ADD CONSTRAINT patient_documents_doc_type_check
    CHECK (doc_type IN ('atestado', 'declaracao', 'receita', 'laudo', 'outro'));

NOTIFY pgrst, 'reload schema';

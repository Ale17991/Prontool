-- 0140 — Documentos do paciente: atestados e biblioteca (backlog 1/10 + 1/4/1).
--
-- Guarda documentos emitidos por paciente (atestado, declaração, etc.). O CID é
-- OPCIONAL (1/10). `issued_at` marca quando foi baixado para envio (1/4/2).
-- O PDF é renderizado sob demanda a partir do conteúdo (não armazenado).
--
-- Próximo número livre na master. Aditiva e idempotente.

CREATE TABLE IF NOT EXISTS public.patient_documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  patient_id      UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  doc_type        TEXT NOT NULL DEFAULT 'atestado'
                    CHECK (doc_type IN ('atestado', 'declaracao', 'outro')),
  title           TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  body            TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 8000),
  cid_code        TEXT NULL,
  cid_description TEXT NULL,
  issued_at       TIMESTAMPTZ NULL,
  created_by      UUID NOT NULL REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ NULL,
  deleted_by      UUID NULL REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS patient_documents_patient_idx
  ON public.patient_documents (tenant_id, patient_id, created_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE public.patient_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS patient_documents_read ON public.patient_documents;
CREATE POLICY patient_documents_read ON public.patient_documents
  FOR SELECT USING (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS patient_documents_write ON public.patient_documents;
CREATE POLICY patient_documents_write ON public.patient_documents
  FOR ALL
  USING  (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN ('admin', 'profissional_saude'))
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN ('admin', 'profissional_saude'));

COMMENT ON TABLE public.patient_documents IS
  'Backlog 1/10 + 1/4/1 — documentos emitidos por paciente (atestado etc.); CID opcional; PDF sob demanda.';

NOTIFY pgrst, 'reload schema';

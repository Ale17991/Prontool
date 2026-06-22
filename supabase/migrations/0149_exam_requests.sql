-- 0149 — Solicitação de exame estruturada (backlog 1/4/1).
--
-- Pedido de exame por paciente: indicação clínica + lista de exames solicitados
-- (snapshot {code, description} do catálogo TUSS tabela 22 ou texto livre).
-- Vínculo opcional ao atendimento que originou o pedido. O PDF é renderizado sob
-- demanda; `issued_at` marca quando foi baixado para envio (mesmo padrão 1/4/2 de
-- `patient_documents`). Aditiva e idempotente.

CREATE TABLE IF NOT EXISTS public.exam_requests (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  patient_id          UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  appointment_id      UUID NULL REFERENCES public.appointments(id) ON DELETE SET NULL,
  doctor_id           UUID NULL REFERENCES public.doctors(id),
  -- Itens solicitados: array JSON de { code, description }. `code` pode ser nulo
  -- (exame em texto livre); `description` é sempre exigido pela aplicação.
  items               JSONB NOT NULL DEFAULT '[]'::jsonb
                        CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) BETWEEN 1 AND 50),
  clinical_indication TEXT NULL CHECK (clinical_indication IS NULL OR char_length(clinical_indication) <= 4000),
  notes               TEXT NULL CHECK (notes IS NULL OR char_length(notes) <= 2000),
  issued_at           TIMESTAMPTZ NULL,
  created_by          UUID NOT NULL REFERENCES auth.users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ NULL,
  deleted_by          UUID NULL REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS exam_requests_patient_idx
  ON public.exam_requests (tenant_id, patient_id, created_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE public.exam_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS exam_requests_read ON public.exam_requests;
CREATE POLICY exam_requests_read ON public.exam_requests
  FOR SELECT USING (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS exam_requests_write ON public.exam_requests;
CREATE POLICY exam_requests_write ON public.exam_requests
  FOR ALL
  USING  (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN ('admin', 'profissional_saude'))
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN ('admin', 'profissional_saude'));

COMMENT ON TABLE public.exam_requests IS
  'Backlog 1/4/1 — solicitação de exame por paciente (indicação clínica + itens TUSS); PDF sob demanda; issued_at marca baixado p/ envio.';

NOTIFY pgrst, 'reload schema';

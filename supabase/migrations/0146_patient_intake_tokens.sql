-- 0146 — Link de auto-cadastro do paciente (backlog 1/3).
--
-- Token de uso único (expira) que abre um formulário PÚBLICO onde o próprio
-- paciente completa contato e endereço. A submissão atualiza a ficha. O token
-- é a credencial (single-use + expiry); o formulário só ESCREVE (não expõe PII).
--
-- Acesso público vai pelo service-role (rotas /api/public/...). RLS restringe
-- leitura/escrita autenticada à equipe do tenant.

CREATE TABLE IF NOT EXISTS public.patient_intake_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  patient_id  UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ NULL,
  created_by  UUID NOT NULL REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS patient_intake_tokens_patient_idx
  ON public.patient_intake_tokens (tenant_id, patient_id, created_at DESC);

ALTER TABLE public.patient_intake_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS patient_intake_tokens_staff ON public.patient_intake_tokens;
CREATE POLICY patient_intake_tokens_staff ON public.patient_intake_tokens
  FOR ALL
  USING  (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN ('admin', 'recepcionista'))
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN ('admin', 'recepcionista'));

COMMENT ON TABLE public.patient_intake_tokens IS
  'Backlog 1/3 — token de auto-cadastro do paciente (link público de uso único).';

NOTIFY pgrst, 'reload schema';

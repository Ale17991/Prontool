-- 0117 — Feature 032: orientações ao paciente (seção "Orientações" do portal).
--
-- (0116 está reservada pela feature 031/platform_admins, ainda não mesclada —
--  usar 0117 evita colisão de numeração quando ambas chegarem na master.)
--
-- Texto livre que o profissional escreve PARA o paciente (orientações, plano de
-- cuidado, recomendações). Aparece no portal quando a clínica habilita a seção
-- `orientacoes` (tenant_portal_sections, 0115). Não é prontuário clínico cru —
-- é conteúdo mediado pelo profissional, adequado à exposição (CFM Art. 34/88).
--
-- Constituição: III multi-tenant (RLS por jwt_tenant_id); V RBAC (escrita
-- admin/profissional_saude). Portal lê via service-role escopado pela sessão.
-- Reversibilidade: aditiva, idempotente.

CREATE TABLE IF NOT EXISTS public.patient_care_notes (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  patient_id         UUID        NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  body               TEXT        NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  created_by_user_id UUID        NOT NULL REFERENCES auth.users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS patient_care_notes_patient_idx
  ON public.patient_care_notes (tenant_id, patient_id, created_at DESC);

COMMENT ON TABLE public.patient_care_notes IS
  'Feature 032 — orientações escritas pelo profissional para o paciente. Exibidas no portal quando a seção "orientacoes" está habilitada (tenant_portal_sections).';

ALTER TABLE public.patient_care_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS patient_care_notes_read ON public.patient_care_notes;
CREATE POLICY patient_care_notes_read ON public.patient_care_notes
  FOR SELECT TO authenticated
  USING (tenant_id = public.jwt_tenant_id());

-- Escrita: clínicos (admin ou profissional de saúde). Recepção não escreve orientação.
DROP POLICY IF EXISTS patient_care_notes_clinico_insert ON public.patient_care_notes;
CREATE POLICY patient_care_notes_clinico_insert ON public.patient_care_notes
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN ('admin', 'profissional_saude'));

DROP POLICY IF EXISTS patient_care_notes_clinico_delete ON public.patient_care_notes;
CREATE POLICY patient_care_notes_clinico_delete ON public.patient_care_notes
  FOR DELETE TO authenticated
  USING (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN ('admin', 'profissional_saude'));

GRANT SELECT, INSERT, DELETE ON public.patient_care_notes TO authenticated;

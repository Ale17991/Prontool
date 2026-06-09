-- 0114 — Feature 030: configuração do Portal do Paciente por clínica.
--
-- Complementa a 0113 (que criou o portal, o motor de medições e o catálogo
-- global `patient_metric_types`). Aqui entra o que faltava para a clínica
-- CONTROLAR o portal pela UI admin:
--
--   1. tenant_clinic_profile.patient_portal_enabled — liga/desliga do portal.
--      Default FALSE: o portal fica fora do ar até o admin habilitar
--      explicitamente (antes da 0114 ele respondia para qualquer slug; agora
--      é opt-in, comportamento mais seguro e previsível).
--   2. tenant_patient_metric_settings — quais métricas do catálogo global
--      cada clínica expõe. Ausência de linha = métrica habilitada (default
--      "tudo ligado"); linha com enabled=false esconde a métrica daquela
--      clínica (no portal do paciente e na tela da equipe).
--
-- Constituição:
--   - III multi-tenant: tenant_id + RLS por jwt_tenant_id() em tudo.
--   - V RBAC: escrita das settings restrita a admin (jwt_role()).
--
-- Reversibilidade: aditiva, idempotente. supabase:reset recria.

-- =========================================================================
-- 1. tenant_clinic_profile.patient_portal_enabled
-- =========================================================================

ALTER TABLE public.tenant_clinic_profile
  ADD COLUMN IF NOT EXISTS patient_portal_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tenant_clinic_profile.patient_portal_enabled IS
  'Feature 030 — liga/desliga do Portal do Paciente. Quando false, /paciente/{slug} não resolve a clínica (login bloqueado). Independente de public_booking_enabled (que governa só o agendamento online).';

-- =========================================================================
-- 2. tenant_patient_metric_settings — seleção de métricas por clínica
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.tenant_patient_metric_settings (
  tenant_id    UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  metric_type  TEXT NOT NULL REFERENCES public.patient_metric_types(metric_type) ON DELETE CASCADE,
  enabled      BOOLEAN NOT NULL DEFAULT true,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, metric_type)
);

COMMENT ON TABLE public.tenant_patient_metric_settings IS
  'Feature 030 — override por clínica do catálogo global patient_metric_types. Sem linha = métrica habilitada (default). enabled=false esconde a métrica daquela clínica no portal e na tela da equipe.';

ALTER TABLE public.tenant_patient_metric_settings ENABLE ROW LEVEL SECURITY;

-- Leitura: usuários da própria clínica.
DROP POLICY IF EXISTS tenant_patient_metric_settings_read ON public.tenant_patient_metric_settings;
CREATE POLICY tenant_patient_metric_settings_read ON public.tenant_patient_metric_settings
  FOR SELECT TO authenticated
  USING (tenant_id = public.jwt_tenant_id());

-- Escrita (INSERT/UPDATE/DELETE): apenas admin da própria clínica.
DROP POLICY IF EXISTS tenant_patient_metric_settings_admin_insert ON public.tenant_patient_metric_settings;
CREATE POLICY tenant_patient_metric_settings_admin_insert ON public.tenant_patient_metric_settings
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() = 'admin');

DROP POLICY IF EXISTS tenant_patient_metric_settings_admin_update ON public.tenant_patient_metric_settings;
CREATE POLICY tenant_patient_metric_settings_admin_update ON public.tenant_patient_metric_settings
  FOR UPDATE TO authenticated
  USING (tenant_id = public.jwt_tenant_id() AND public.jwt_role() = 'admin')
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() = 'admin');

DROP POLICY IF EXISTS tenant_patient_metric_settings_admin_delete ON public.tenant_patient_metric_settings;
CREATE POLICY tenant_patient_metric_settings_admin_delete ON public.tenant_patient_metric_settings
  FOR DELETE TO authenticated
  USING (tenant_id = public.jwt_tenant_id() AND public.jwt_role() = 'admin');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_patient_metric_settings TO authenticated;

-- 0115 — Feature 032: seções configuráveis do Portal do Paciente.
--
-- Evolui a 0113/0114: além de ligar/desligar o portal inteiro
-- (tenant_clinic_profile.patient_portal_enabled) e escolher quais MÉTRICAS
-- aparecem (tenant_patient_metric_settings), a clínica agora escolhe quais
-- SEÇÕES o paciente vê (atendimentos, métricas, orientações, exames, etc.).
--
-- O CATÁLOGO de seções (chaves válidas, default on/off, sensibilidade, módulo
-- exigido) vive no código (`src/lib/core/patient-portal/sections.ts`) — fonte
-- da verdade única, como o catálogo de planos da 031. Esta tabela guarda só o
-- OVERRIDE por clínica:
--   - sem linha  = usa o default do catálogo (algumas on, sensíveis off);
--   - enabled=true/false = a clínica forçou ligar/desligar aquela seção.
--
-- Modelo idêntico ao tenant_patient_metric_settings (0114): PK composta,
-- RLS leitura same-tenant, escrita admin-only.
--
-- Constituição: III multi-tenant (RLS por jwt_tenant_id); V RBAC (escrita admin).
-- Reversibilidade: aditiva, idempotente. supabase:reset recria.

CREATE TABLE IF NOT EXISTS public.tenant_portal_sections (
  tenant_id    UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  section_key  TEXT NOT NULL CHECK (section_key ~ '^[a-z][a-z0-9_]{1,39}$'),
  enabled      BOOLEAN NOT NULL DEFAULT true,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, section_key)
);

COMMENT ON TABLE public.tenant_portal_sections IS
  'Feature 032 — override por clínica de quais seções o Portal do Paciente exibe. Sem linha = default do catálogo (src/lib/core/patient-portal/sections.ts). Seções sensíveis nascem off por padrão (CFM Art. 34/88); módulo-pago também depende do entitlement do plano (031).';

ALTER TABLE public.tenant_portal_sections ENABLE ROW LEVEL SECURITY;

-- Leitura: usuários da própria clínica.
DROP POLICY IF EXISTS tenant_portal_sections_read ON public.tenant_portal_sections;
CREATE POLICY tenant_portal_sections_read ON public.tenant_portal_sections
  FOR SELECT TO authenticated
  USING (tenant_id = public.jwt_tenant_id());

-- Escrita: apenas admin da própria clínica.
DROP POLICY IF EXISTS tenant_portal_sections_admin_insert ON public.tenant_portal_sections;
CREATE POLICY tenant_portal_sections_admin_insert ON public.tenant_portal_sections
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() = 'admin');

DROP POLICY IF EXISTS tenant_portal_sections_admin_update ON public.tenant_portal_sections;
CREATE POLICY tenant_portal_sections_admin_update ON public.tenant_portal_sections
  FOR UPDATE TO authenticated
  USING (tenant_id = public.jwt_tenant_id() AND public.jwt_role() = 'admin')
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() = 'admin');

DROP POLICY IF EXISTS tenant_portal_sections_admin_delete ON public.tenant_portal_sections;
CREATE POLICY tenant_portal_sections_admin_delete ON public.tenant_portal_sections
  FOR DELETE TO authenticated
  USING (tenant_id = public.jwt_tenant_id() AND public.jwt_role() = 'admin');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_portal_sections TO authenticated;

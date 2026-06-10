-- 0115 — Entitlements por tenant: plano + módulos (feature 031).
--
-- Materializa os planos do relatório de preços (Essencial/Pro/Clínica) e os
-- módulos add-on (TISS, Portal do Paciente, Telemedicina, CRM) como dado por
-- clínica, para autorizar o que cada conta enxerga. A matriz plano→features
-- vive no código (src/lib/core/entitlements/plans.ts); aqui ficam o plano, o
-- status e os módulos contratados.
--
--   1. CREATE tenant_entitlements (1:1 com tenants)
--   2. Backfill: tenants atuais viram 'legacy' (acesso total — grandfather)
--   3. set_tenant_entitlement(...) — escrita de ops (service_role)
--   4. create_first_tenant — recriada para nascer no plano 'essencial'
--
-- Constituição: III multi-tenant (RLS por jwt_tenant_id); V RBAC (escrita só
-- service_role/ops). Reversibilidade: aditiva e idempotente.

-- =========================================================================
-- 1. tenant_entitlements
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.tenant_entitlements (
  tenant_id     UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  plan          TEXT NOT NULL CHECK (plan IN ('essencial', 'pro', 'clinica', 'legacy')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('trial', 'active', 'past_due', 'canceled')),
  trial_ends_at TIMESTAMPTZ NULL,
  modules       TEXT[] NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tenant_entitlements IS
  'Feature 031 — plano + módulos add-on por clínica. Matriz plano→features no código. modules: tiss, portal_paciente, telemedicina, crm. Linha ausente ⇒ tratada como legacy/full no app (defensivo).';

DROP TRIGGER IF EXISTS tenant_entitlements_touch_updated_at ON public.tenant_entitlements;
CREATE TRIGGER tenant_entitlements_touch_updated_at
  BEFORE UPDATE ON public.tenant_entitlements
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.tenant_entitlements ENABLE ROW LEVEL SECURITY;

-- Leitura: membros do próprio tenant.
DROP POLICY IF EXISTS tenant_entitlements_read ON public.tenant_entitlements;
CREATE POLICY tenant_entitlements_read ON public.tenant_entitlements
  FOR SELECT TO authenticated
  USING (tenant_id = public.jwt_tenant_id());

-- Escrita: somente service_role (ops). Sem policy para authenticated.
GRANT SELECT ON public.tenant_entitlements TO authenticated;

-- =========================================================================
-- 2. Backfill grandfather: tenants atuais = 'legacy' com todos os módulos.
-- =========================================================================

INSERT INTO public.tenant_entitlements (tenant_id, plan, status, modules)
SELECT t.id, 'legacy', 'active', ARRAY['tiss', 'portal_paciente', 'telemedicina', 'crm']
FROM public.tenants t
ON CONFLICT (tenant_id) DO NOTHING;

-- =========================================================================
-- 3. set_tenant_entitlement — escrita de ops (SECURITY DEFINER, service_role)
-- =========================================================================

CREATE OR REPLACE FUNCTION public.set_tenant_entitlement(
  p_tenant_id UUID,
  p_plan      TEXT,
  p_modules   TEXT[] DEFAULT '{}',
  p_status    TEXT DEFAULT 'active'
) RETURNS public.tenant_entitlements
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  row public.tenant_entitlements;
BEGIN
  IF p_plan NOT IN ('essencial', 'pro', 'clinica', 'legacy') THEN
    RAISE EXCEPTION 'plano inválido: %', p_plan USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.tenant_entitlements (tenant_id, plan, status, modules)
  VALUES (p_tenant_id, p_plan, COALESCE(p_status, 'active'), COALESCE(p_modules, '{}'))
  ON CONFLICT (tenant_id) DO UPDATE
    SET plan = EXCLUDED.plan, status = EXCLUDED.status,
        modules = EXCLUDED.modules, updated_at = now()
  RETURNING * INTO row;
  RETURN row;
END $$;

REVOKE ALL ON FUNCTION public.set_tenant_entitlement(UUID, TEXT, TEXT[], TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_tenant_entitlement(UUID, TEXT, TEXT[], TEXT) TO service_role;

COMMENT ON FUNCTION public.set_tenant_entitlement IS
  'Feature 031 — define plano/módulos/status de um tenant (upsert). Uso de ops via service_role.';

-- =========================================================================
-- 4. create_first_tenant — recriada: nova conta nasce no plano 'essencial'.
--    (Mantém toda a lógica de 0065; acrescenta o INSERT de entitlement.)
-- =========================================================================

CREATE OR REPLACE FUNCTION public.create_first_tenant(
  p_user_id UUID,
  p_name    TEXT,
  p_slug    TEXT,
  p_cnpj    TEXT DEFAULT NULL,
  p_phone   TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  new_tenant_id UUID;
  cnpj_digits   TEXT;
BEGIN
  IF p_user_id IS NULL OR p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'create_first_tenant: p_user_id must equal auth.uid()'
      USING ERRCODE = '42501';
  END IF;
  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN
    RAISE EXCEPTION 'create_first_tenant: p_name is required' USING ERRCODE = '22023';
  END IF;
  IF p_slug IS NULL OR length(btrim(p_slug)) = 0 THEN
    RAISE EXCEPTION 'create_first_tenant: p_slug is required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.tenants (name, slug, status)
  VALUES (btrim(p_name), btrim(p_slug), 'active')
  RETURNING id INTO new_tenant_id;

  INSERT INTO public.user_tenants (user_id, tenant_id, role, status)
  VALUES (p_user_id, new_tenant_id, 'admin', 'active');

  INSERT INTO public.user_active_tenant (user_id, tenant_id, updated_at)
  VALUES (p_user_id, new_tenant_id, now())
  ON CONFLICT (user_id) DO UPDATE
    SET tenant_id = EXCLUDED.tenant_id, updated_at = now();

  cnpj_digits := NULLIF(regexp_replace(COALESCE(p_cnpj, ''), '\D', '', 'g'), '');
  IF cnpj_digits IS NOT NULL AND length(cnpj_digits) <> 14 THEN
    cnpj_digits := NULL;
  END IF;

  INSERT INTO public.tenant_clinic_profile (tenant_id, cnpj, phone)
  VALUES (new_tenant_id, cnpj_digits, NULLIF(btrim(COALESCE(p_phone, '')), ''))
  ON CONFLICT (tenant_id) DO NOTHING;

  -- Feature 031 — conta nova nasce no plano de entrada (Essencial), sem módulos.
  INSERT INTO public.tenant_entitlements (tenant_id, plan, status, modules)
  VALUES (new_tenant_id, 'essencial', 'active', '{}')
  ON CONFLICT (tenant_id) DO NOTHING;

  RETURN new_tenant_id;
END $$;

GRANT EXECUTE ON FUNCTION public.create_first_tenant(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;

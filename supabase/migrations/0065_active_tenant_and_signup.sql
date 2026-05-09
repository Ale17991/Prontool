-- 0065 — Multi-tenant lifecycle, GHL 1:1 binding e filtros do calendário.
--
-- Esta migration é a base do feature 010. Acrescenta o estritamente
-- necessário para suportar:
--   1. Persistência cross-device de "última clínica usada" por usuário.
--   2. Onboarding atômico (criar tenant + admin + active = 1 RPC).
--   3. Hint de "qual tenant é o ativo" lido pelo auth_hook_custom_claims
--      em ordem de prioridade (R6 do research.md).
--
-- Não altera schema de tabelas existentes (tenants, tenant_integrations,
-- user_tenants). A regra GHL 1:1 (US1) já é garantida pelo PK
-- (tenant_id, provider) + UNIQUE INDEX parcial em (location_id) onde
-- provider='ghl' AND enabled=true (feature 008, migration 0062).
--
-- Constituição: Princípios II (audit), III (RLS), V (RBAC) cobertos —
-- a RPC create_first_tenant exige p_user_id = auth.uid(); nenhuma escrita
-- bypass de RLS sai daqui.
-- Reversibilidade: aditiva e idempotente (CREATE OR REPLACE / IF NOT EXISTS).

-- =========================================================================
-- 1. user_active_tenant (NEW) — 1:1 com auth.users.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.user_active_tenant (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id  UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS user_active_tenant_touch_updated_at ON public.user_active_tenant;
CREATE TRIGGER user_active_tenant_touch_updated_at
  BEFORE UPDATE ON public.user_active_tenant
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.user_active_tenant ENABLE ROW LEVEL SECURITY;

-- Self-read: usuário lê apenas a própria row.
DROP POLICY IF EXISTS user_active_tenant_self_read ON public.user_active_tenant;
CREATE POLICY user_active_tenant_self_read ON public.user_active_tenant
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- INSERT/UPDATE: somente service_role / RPC SECURITY DEFINER. O switch-tenant
-- rota chama via service-role; o create_first_tenant RPC roda como SECURITY
-- DEFINER. Não há policy para authenticated escrever — bloqueio por ausência.

GRANT SELECT ON public.user_active_tenant TO authenticated;

CREATE INDEX IF NOT EXISTS user_active_tenant_tenant_idx
  ON public.user_active_tenant (tenant_id);

COMMENT ON TABLE public.user_active_tenant IS '1:1 com auth.users. Persiste a última clínica usada cross-device para o auth_hook resolver tenant_id no JWT. Prioridade no hook: user_metadata.active_tenant_id > user_active_tenant > primeiro tenant ativo.';

-- =========================================================================
-- 2. create_first_tenant (NEW SECURITY DEFINER) — atomicidade do onboarding.
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
  -- Defesa: caller só pode criar tenant pra si mesmo.
  IF p_user_id IS NULL OR p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'create_first_tenant: p_user_id must equal auth.uid()'
      USING ERRCODE = '42501';
  END IF;

  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN
    RAISE EXCEPTION 'create_first_tenant: p_name is required'
      USING ERRCODE = '22023';
  END IF;
  IF p_slug IS NULL OR length(btrim(p_slug)) = 0 THEN
    RAISE EXCEPTION 'create_first_tenant: p_slug is required'
      USING ERRCODE = '22023';
  END IF;

  -- Tenant.
  INSERT INTO public.tenants (name, slug, status)
  VALUES (btrim(p_name), btrim(p_slug), 'active')
  RETURNING id INTO new_tenant_id;

  -- Vínculo admin ativo.
  INSERT INTO public.user_tenants (user_id, tenant_id, role, status)
  VALUES (p_user_id, new_tenant_id, 'admin', 'active');

  -- Última clínica usada — UPSERT defensivo (caso o usuário tenha vínculo
  -- residual a outro tenant que já tenha sido apagado; ON DELETE CASCADE
  -- limpa, mas idempotência é cheap).
  INSERT INTO public.user_active_tenant (user_id, tenant_id, updated_at)
  VALUES (p_user_id, new_tenant_id, now())
  ON CONFLICT (user_id) DO UPDATE
    SET tenant_id = EXCLUDED.tenant_id, updated_at = now();

  -- tenant_clinic_profile lazy. Aceita CNPJ formatado ou só dígitos —
  -- normaliza para 14 dígitos. CNPJ inválido (tamanho ≠ 14) é tratado
  -- como "não preenchido" para não derrubar o onboarding inteiro; o admin
  -- pode corrigir depois em /configuracoes/clinica.
  cnpj_digits := NULLIF(regexp_replace(COALESCE(p_cnpj, ''), '\D', '', 'g'), '');
  IF cnpj_digits IS NOT NULL AND length(cnpj_digits) <> 14 THEN
    cnpj_digits := NULL;
  END IF;

  INSERT INTO public.tenant_clinic_profile (tenant_id, cnpj, phone)
  VALUES (
    new_tenant_id,
    cnpj_digits,
    NULLIF(btrim(COALESCE(p_phone, '')), '')
  )
  ON CONFLICT (tenant_id) DO NOTHING;

  RETURN new_tenant_id;
END $$;

GRANT EXECUTE ON FUNCTION public.create_first_tenant(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.create_first_tenant(UUID, TEXT, TEXT, TEXT, TEXT) IS 'Onboarding atômico (FR-014). Cria tenant + vincula caller como admin ativo + define como última clínica usada + lazy-init clinic_profile. SECURITY DEFINER — caller deve ter auth.uid() = p_user_id.';

-- =========================================================================
-- 3. auth_hook_custom_claims (ALTERED) — leitura prioritária user_active_tenant
-- =========================================================================
--
-- Mantém estrutura corrigida em 0022 (claims em app_metadata, jsonb
-- text-accessors) e o filtro `status='active'` de 0064. Acrescenta o passo
-- (2): se nenhum hint via user_metadata.active_tenant_id, lê
-- user_active_tenant antes do fallback "primeiro tenant ativo". Order: R6.

CREATE OR REPLACE FUNCTION public.auth_hook_custom_claims(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid         UUID;
  desired_tid UUID;
  picked_tid  UUID;
  picked_role TEXT;
  claims      jsonb;
BEGIN
  uid := NULLIF(event ->> 'user_id', '')::uuid;
  desired_tid := NULLIF(event #>> '{user_metadata,active_tenant_id}', '')::uuid;

  -- (1) Hint do switch atual (user_metadata).
  IF desired_tid IS NOT NULL THEN
    SELECT tenant_id, role INTO picked_tid, picked_role
    FROM public.user_tenants
    WHERE user_id = uid
      AND tenant_id = desired_tid
      AND status = 'active'
    LIMIT 1;
  END IF;

  -- (2) Última clínica usada (cross-device).
  IF picked_tid IS NULL THEN
    SELECT ut.tenant_id, ut.role INTO picked_tid, picked_role
    FROM public.user_active_tenant uat
    JOIN public.user_tenants ut
      ON ut.user_id = uat.user_id AND ut.tenant_id = uat.tenant_id
    WHERE uat.user_id = uid AND ut.status = 'active'
    LIMIT 1;
  END IF;

  -- (3) Primeiro vínculo ativo qualquer.
  IF picked_tid IS NULL THEN
    SELECT tenant_id, role INTO picked_tid, picked_role
    FROM public.user_tenants
    WHERE user_id = uid
      AND status = 'active'
    LIMIT 1;
  END IF;

  claims := COALESCE(event -> 'claims', '{}'::jsonb);
  IF picked_tid IS NOT NULL THEN
    claims := jsonb_set(
      claims,
      '{app_metadata}',
      COALESCE(claims -> 'app_metadata', '{}'::jsonb)
        || jsonb_build_object('tenant_id', picked_tid::text, 'role', picked_role),
      true
    );
  END IF;

  RETURN jsonb_set(event, '{claims}', claims);
END $$;

GRANT EXECUTE ON FUNCTION public.auth_hook_custom_claims(jsonb) TO supabase_auth_admin;

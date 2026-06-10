-- 0119 — Admin-Agência em 2 níveis + acesso cross-tenant escopado (feature 031).
-- (Renumerada de 0117→0119: 0117/0118 já ocupadas por outra branch em voo.)
--
-- A 0116 criou platform_admins. Aqui:
--   1. platform_admins.is_super — admin GERAL (vê/gerencia tudo + todas as
--      clínicas) vs SUPORTE (só clínicas atribuídas). Grandfather: linhas
--      existentes viram super.
--   2. platform_admin_tenants — quais clínicas cada usuário de suporte pode
--      acessar (gerenciado pelo admin geral no /admin). Super ignora (todas).
--   3. auth_hook_custom_claims — caminho (1b): platform admin assumindo a
--      clínica que ESCOLHEU (active_tenant_id), como role='admin', se for super
--      OU tiver a clínica atribuída. Opt-in e isolado: usuário comum inalterado.
--
-- CREATE/ALTER idempotentes; CREATE OR REPLACE no hook.

-- =========================================================================
-- 1. platform_admins.is_super
-- =========================================================================
ALTER TABLE public.platform_admins
  ADD COLUMN IF NOT EXISTS is_super BOOLEAN NOT NULL DEFAULT false;

-- Grandfather: quem já era platform_admin foi criado como "geral" → super.
UPDATE public.platform_admins SET is_super = true WHERE is_super = false;

COMMENT ON COLUMN public.platform_admins.is_super IS
  'true = admin geral (vê/gerencia tudo + todas as clínicas). false = suporte (só clínicas em platform_admin_tenants).';

-- =========================================================================
-- 2. platform_admin_tenants — atribuição de clínicas ao suporte
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.platform_admin_tenants (
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id  UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tenant_id)
);
COMMENT ON TABLE public.platform_admin_tenants IS
  'Feature 031 — clínicas que cada usuário de suporte (platform_admins.is_super=false) pode acessar. Gerenciado pelo admin geral. Super ignora (acessa todas). Sem acesso por authenticated; service_role only.';

ALTER TABLE public.platform_admin_tenants ENABLE ROW LEVEL SECURITY;
-- intencional: sem policy para authenticated; só service_role.
CREATE INDEX IF NOT EXISTS platform_admin_tenants_tenant_idx
  ON public.platform_admin_tenants (tenant_id);

-- =========================================================================
-- 3. auth_hook_custom_claims — caminho (1b) cross-tenant escopado
-- =========================================================================
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

  -- (1) Hint do switch atual (user_metadata) — via vínculo.
  IF desired_tid IS NOT NULL THEN
    SELECT ut.tenant_id, ut.role INTO picked_tid, picked_role
    FROM public.user_tenants ut
    JOIN public.tenants t ON t.id = ut.tenant_id AND t.status = 'active'
    WHERE ut.user_id = uid
      AND ut.tenant_id = desired_tid
      AND ut.status = 'active'
    LIMIT 1;
  END IF;

  -- (1b) Admin-Agência (super OU suporte com a clínica atribuída) assumindo a
  -- clínica que ESCOLHEU, sem vínculo. role = admin.
  IF picked_tid IS NULL AND desired_tid IS NOT NULL THEN
    SELECT t.id INTO picked_tid
    FROM public.tenants t
    WHERE t.id = desired_tid AND t.status = 'active'
      AND EXISTS (
        SELECT 1 FROM public.platform_admins pa
        WHERE pa.user_id = uid
          AND (
            pa.is_super
            OR EXISTS (
              SELECT 1 FROM public.platform_admin_tenants pat
              WHERE pat.user_id = uid AND pat.tenant_id = t.id
            )
          )
      )
    LIMIT 1;
    IF picked_tid IS NOT NULL THEN
      picked_role := 'admin';
    END IF;
  END IF;

  -- (2) Última clínica usada (cross-device) — via vínculo.
  IF picked_tid IS NULL THEN
    SELECT ut.tenant_id, ut.role INTO picked_tid, picked_role
    FROM public.user_active_tenant uat
    JOIN public.user_tenants ut
      ON ut.user_id = uat.user_id AND ut.tenant_id = uat.tenant_id
    JOIN public.tenants t
      ON t.id = ut.tenant_id AND t.status = 'active'
    WHERE uat.user_id = uid AND ut.status = 'active'
    LIMIT 1;
  END IF;

  -- (3) Primeiro vínculo ativo qualquer.
  IF picked_tid IS NULL THEN
    SELECT ut.tenant_id, ut.role INTO picked_tid, picked_role
    FROM public.user_tenants ut
    JOIN public.tenants t ON t.id = ut.tenant_id AND t.status = 'active'
    WHERE ut.user_id = uid
      AND ut.status = 'active'
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

NOTIFY pgrst, 'reload schema';

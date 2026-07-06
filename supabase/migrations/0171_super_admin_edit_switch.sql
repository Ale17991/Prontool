-- 0171 - Super-admin entra em outra clinica COM edicao (switch livre p/ testes).
--
-- A 0167 tornou TODO acesso cross-tenant (platform-admin assumindo clinica sem
-- vinculo) uma sessao de impersonacao READ-ONLY, marcando o JWT com
-- app_metadata.impersonation=true. Isso trava o super-admin em "modo de
-- visualizacao" ao entrar em qualquer clinica.
--
-- Decisao (dono, 2026-07-06): "Super escolhe ao entrar".
--   - SUPER-admin: por padrao entra COM edicao. So fica read-only quando escolhe
--     "So visualizar" (flag user_metadata.support_view_tenant_id = tenant alvo).
--   - SUPORTE (platform-admin NAO-super): continua SEMPRE read-only; a flag e
--     ignorada para nao-super (sem escalonamento).
--
-- Corpo identico a 0167, exceto o calculo de impers no caminho (1b) + v_is_super.

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
  impers      boolean := false;
  v_is_super  boolean := false;
BEGIN
  uid := NULLIF(event ->> 'user_id', '')::uuid;

  -- Tenant escolhido (switch). Fontes em ordem de confianca:
  desired_tid := NULLIF(event #>> '{user_metadata,active_tenant_id}', '')::uuid;
  IF desired_tid IS NULL THEN
    desired_tid := NULLIF(event #>> '{claims,user_metadata,active_tenant_id}', '')::uuid;
  END IF;
  IF desired_tid IS NULL AND uid IS NOT NULL THEN
    SELECT uat.tenant_id INTO desired_tid
    FROM public.user_active_tenant uat
    WHERE uat.user_id = uid;
  END IF;

  -- (1) Tenant escolhido via vinculo ativo.
  IF desired_tid IS NOT NULL THEN
    SELECT ut.tenant_id, ut.role INTO picked_tid, picked_role
    FROM public.user_tenants ut
    JOIN public.tenants t ON t.id = ut.tenant_id AND t.status = 'active'
    WHERE ut.user_id = uid
      AND ut.tenant_id = desired_tid
      AND ut.status = 'active'
    LIMIT 1;
  END IF;

  -- (1b) Admin-Agencia (super OU suporte com a clinica atribuida) assumindo a
  -- clinica que ESCOLHEU, sem vinculo. role = admin.
  IF picked_tid IS NULL AND desired_tid IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.platform_admins pa
      WHERE pa.user_id = uid AND pa.is_super
    ) INTO v_is_super;

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
      -- Read-only quando: suporte (nao-super) SEMPRE; ou super que escolheu
      -- "So visualizar" para ESTA clinica. Senao, super entra COM edicao.
      IF NOT v_is_super
         OR NULLIF(event #>> '{user_metadata,support_view_tenant_id}', '')::uuid = picked_tid
      THEN
        impers := true;
      END IF;
    END IF;
  END IF;

  -- (2) Ultima clinica usada (cross-device) via vinculo.
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

  -- (3) Primeiro vinculo ativo qualquer.
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
        || jsonb_build_object('tenant_id', picked_tid::text, 'role', picked_role)
        || CASE WHEN impers THEN jsonb_build_object('impersonation', true)
                ELSE '{}'::jsonb END,
      true
    );
  END IF;

  RETURN jsonb_set(event, '{claims}', claims);
END $$;

GRANT EXECUTE ON FUNCTION public.auth_hook_custom_claims(jsonb) TO supabase_auth_admin;

NOTIFY pgrst, 'reload schema';

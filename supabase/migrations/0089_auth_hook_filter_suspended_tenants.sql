-- 0089 — auth_hook_custom_claims filtra tenants suspensos.
--
-- Antes (0065): os 3 caminhos do hook filtravam `user_tenants.status='active'`
-- mas não `tenants.status='active'`. Usuário com vínculo ativo num tenant
-- suspenso ainda recebia claims `tenant_id`/`role` e podia operar.
-- `switchActiveTenant` (src/lib/core/auth/switch-tenant.ts:80) já valida
-- isso no caminho do switch — mas o hook é invocado em todo refresh de
-- JWT, então sessões já vivas escapavam do gate.
--
-- Agora: os 3 caminhos (user_metadata, user_active_tenant, fallback) fazem
-- JOIN com tenants para exigir status='active'. Tenant suspenso ->
-- claims vazias -> jwt_tenant_id() retorna NULL -> RLS bloqueia tudo
-- (kill-switch alinhado com o de user_tenants.status='disabled').

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
    SELECT ut.tenant_id, ut.role INTO picked_tid, picked_role
    FROM public.user_tenants ut
    JOIN public.tenants t ON t.id = ut.tenant_id AND t.status = 'active'
    WHERE ut.user_id = uid
      AND ut.tenant_id = desired_tid
      AND ut.status = 'active'
    LIMIT 1;
  END IF;

  -- (2) Última clínica usada (cross-device).
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

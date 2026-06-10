-- 0121 — Corrige o caminho cross-tenant (1b) do auth hook (bug da 0119).
--
-- PROBLEMA: a 0119 lia o tenant escolhido de `event #>> '{user_metadata,...}'`
-- (topo do evento). No evento REAL do GoTrue, `user_metadata` fica DENTRO de
-- `claims` → esse caminho é sempre NULL → o caminho (1b) do Admin-Agência nunca
-- disparava → admin assumia "primeiro vínculo" (a própria clínica) em vez da
-- clínica escolhida. Membros normais escapavam pela tabela user_active_tenant
-- (caminho 2), mas cross-tenant (sem vínculo) depende do 1b.
--
-- CORREÇÃO: `desired_tid` agora vem, em ordem, de:
--   (a) event user_metadata no topo (compat),
--   (b) event claims.user_metadata (formato real do GoTrue),
--   (c) tabela user_active_tenant (fonte autoritativa que o switch grava).
-- Assim o (1b) recebe a clínica escolhida e o Admin-Agência entra em qualquer
-- clínica permitida.

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

  -- Tenant escolhido (switch). Fontes em ordem de confiança:
  desired_tid := NULLIF(event #>> '{user_metadata,active_tenant_id}', '')::uuid;
  IF desired_tid IS NULL THEN
    desired_tid := NULLIF(event #>> '{claims,user_metadata,active_tenant_id}', '')::uuid;
  END IF;
  IF desired_tid IS NULL AND uid IS NOT NULL THEN
    SELECT uat.tenant_id INTO desired_tid
    FROM public.user_active_tenant uat
    WHERE uat.user_id = uid;
  END IF;

  -- (1) Tenant escolhido — via vínculo ativo.
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

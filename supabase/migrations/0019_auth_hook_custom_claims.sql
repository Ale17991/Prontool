-- T033: Supabase Auth custom access token hook.
-- On every token issuance, populate `tenant_id` and `role` claims from
-- user_tenants. If the user has multiple tenants, the app chooses one at
-- login and passes it via user_metadata.active_tenant_id; otherwise the
-- sole tenant is used.

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
  uid := (event -> 'user_id')::text::uuid;
  desired_tid := NULLIF((event -> 'user_metadata' ->> 'active_tenant_id'), '')::uuid;

  IF desired_tid IS NOT NULL THEN
    SELECT tenant_id, role INTO picked_tid, picked_role
    FROM public.user_tenants
    WHERE user_id = uid AND tenant_id = desired_tid
    LIMIT 1;
  END IF;

  -- Fallback: single-tenant user
  IF picked_tid IS NULL THEN
    SELECT tenant_id, role INTO picked_tid, picked_role
    FROM public.user_tenants
    WHERE user_id = uid
    LIMIT 2;
  END IF;

  claims := COALESCE(event -> 'claims', '{}'::jsonb);
  IF picked_tid IS NOT NULL THEN
    claims := jsonb_set(claims, '{tenant_id}', to_jsonb(picked_tid::text));
    claims := jsonb_set(claims, '{role}',      to_jsonb(picked_role));
  END IF;

  RETURN jsonb_set(event, '{claims}', claims);
END $$;

-- Supabase reads this via auth.hook.custom_access_token in config.toml.
GRANT EXECUTE ON FUNCTION public.auth_hook_custom_claims(jsonb) TO supabase_auth_admin;

-- The original `auth_hook_custom_claims` (0019) extracted user_id with
-- `(event -> 'user_id')::text::uuid`. The `->` operator returns jsonb,
-- and casting a jsonb string to text preserves the surrounding quotes
-- (`"abc..."`), which then fails the uuid cast. Use the `->>` text
-- accessor instead so the value arrives as a bare uuid string.

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
    LIMIT 1;
  END IF;

  -- Build the custom claims under app_metadata. Keeping the top-level
  -- `role` claim untouched is required for PostgREST role switching;
  -- jwt_role() / jwt_tenant_id() (migration 0021) read app_metadata
  -- first and fall back to top-level.
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

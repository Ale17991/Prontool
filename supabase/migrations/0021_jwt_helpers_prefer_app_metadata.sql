-- The JWT claim helpers originally read `role` and `tenant_id` from the
-- top-level of `auth.jwt()`. That breaks for any token where the top-level
-- `role` must stay as `authenticated` (so PostgREST can SET ROLE to one of
-- its three managed roles) while the tenant role lives under
-- `app_metadata.role` — the shape test tokens use today and the shape a
-- future production auth hook will likely adopt for the same reason.
--
-- Redefine the helpers to prefer `app_metadata.*` and fall back to
-- top-level. The existing RLS policies (0017_rls_policies.sql) call these
-- functions unchanged.

CREATE OR REPLACE FUNCTION public.jwt_role()
RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    NULLIF(auth.jwt() #>> '{app_metadata,role}', ''),
    NULLIF(auth.jwt() ->> 'role', ''),
    ''
  )
$$;

CREATE OR REPLACE FUNCTION public.jwt_tenant_id()
RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(
    COALESCE(
      NULLIF(auth.jwt() #>> '{app_metadata,tenant_id}', ''),
      NULLIF(auth.jwt() ->> 'tenant_id', '')
    ),
    ''
  )::uuid
$$;

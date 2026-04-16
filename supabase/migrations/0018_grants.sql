-- T030: Grants. Belt to RLS's suspenders.
-- authenticated role: the JWT-authenticated user. Can SELECT and INSERT
-- into non-financial tables where RLS allows, but MUST NOT UPDATE/DELETE
-- financial ones.
-- service_role: bypasses RLS (used only by webhook ingestion and workers).

-- Revoke default write perms on append-only financial tables
REVOKE UPDATE, DELETE ON public.appointments                FROM authenticated;
REVOKE UPDATE, DELETE ON public.appointment_reversals       FROM authenticated;
REVOKE UPDATE, DELETE ON public.price_versions              FROM authenticated;
REVOKE UPDATE, DELETE ON public.doctor_commission_history   FROM authenticated;
REVOKE UPDATE, DELETE ON public.audit_log                   FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.audit_log           FROM authenticated;
REVOKE UPDATE, DELETE ON public.webhook_event_transitions   FROM authenticated;
REVOKE UPDATE, DELETE ON public.alert_status_transitions    FROM authenticated;
REVOKE UPDATE, DELETE ON public.tuss_codes                  FROM authenticated;
REVOKE INSERT ON public.tuss_codes                          FROM authenticated;
REVOKE UPDATE, DELETE ON public.tuss_catalog_versions       FROM authenticated;
REVOKE INSERT ON public.tuss_catalog_versions               FROM authenticated;

-- raw_webhook_events: tenant users only SELECT. All writes via service_role.
REVOKE INSERT, UPDATE, DELETE ON public.raw_webhook_events  FROM authenticated;

-- Appointments are inserted only by the worker (service_role); tenant users
-- never insert directly.
REVOKE INSERT ON public.appointments                        FROM authenticated;

-- Patients are upserted only by the worker (service_role).
REVOKE INSERT, UPDATE, DELETE ON public.patients            FROM authenticated;

-- Final SELECT grants on global catalog (read-only for everyone).
GRANT SELECT ON public.tuss_codes                           TO authenticated, anon;
GRANT SELECT ON public.tuss_catalog_versions                TO authenticated, anon;

-- service_role keeps full access by default in Supabase; no explicit grant needed.

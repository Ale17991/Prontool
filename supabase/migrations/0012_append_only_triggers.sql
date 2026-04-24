-- T024: Principle I enforcement. Two-layer defense: REVOKE at role level
-- (0018_grants.sql) and BEFORE UPDATE/DELETE trigger that raises regardless
-- of grants. Migrations run as service_role / supabase_admin which is
-- explicitly exempted.

CREATE OR REPLACE FUNCTION public.enforce_append_only()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Supabase migration runner and service-role are the only actors
  -- allowed to bypass. Everyone else is blocked.
  IF current_user IN ('postgres', 'supabase_admin', 'service_role', 'supabase_auth_admin') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  RAISE EXCEPTION USING
    MESSAGE = format('Append-only table: %s mutation forbidden (op=%s)', TG_TABLE_NAME, TG_OP),
    ERRCODE = '42501';
END $$;

-- Attach to append-only tables.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'appointments',
    'appointment_reversals',
    'price_versions',
    'doctor_commission_history',
    'audit_log',
    'webhook_event_transitions',
    'alert_status_transitions',
    'tuss_catalog_versions'
  ]) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_enforce_append_only ON public.%I', t, t);
    EXECUTE format($f$
      CREATE TRIGGER %I_enforce_append_only
      BEFORE UPDATE OR DELETE ON public.%I
      FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only()
    $f$, t, t);
  END LOOP;
END $$;

-- raw_webhook_events is partially mutable (processing_status, last_processed_at,
-- processing_attempt_count). Apply a column-scoped guard instead.
CREATE OR REPLACE FUNCTION public.enforce_raw_event_immutable_payload()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role') THEN
    RETURN NEW;
  END IF;

  IF NEW.tenant_id    IS DISTINCT FROM OLD.tenant_id
     OR NEW.ghl_event_id IS DISTINCT FROM OLD.ghl_event_id
     OR NEW.payload   IS DISTINCT FROM OLD.payload
     OR NEW.headers   IS DISTINCT FROM OLD.headers
     OR NEW.received_at IS DISTINCT FROM OLD.received_at THEN
    RAISE EXCEPTION USING
      MESSAGE = 'raw_webhook_events: payload/headers/identity columns are immutable',
      ERRCODE = '42501';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS raw_webhook_events_immutable_payload ON public.raw_webhook_events;
CREATE TRIGGER raw_webhook_events_immutable_payload
  BEFORE UPDATE ON public.raw_webhook_events
  FOR EACH ROW EXECUTE FUNCTION public.enforce_raw_event_immutable_payload();

DROP TRIGGER IF EXISTS raw_webhook_events_no_delete ON public.raw_webhook_events;
CREATE TRIGGER raw_webhook_events_no_delete
  BEFORE DELETE ON public.raw_webhook_events
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only();

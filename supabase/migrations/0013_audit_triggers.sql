-- T025: Audit triggers (Principle II). AFTER INSERT triggers on tracked
-- tables insert one row per meaningful event into audit_log, pulling
-- session-scoped context via current_setting. The Route Handler or worker
-- MUST set these GUCs at the top of each transaction:
--   SET LOCAL app.actor_id       = '<uuid>';     -- NULL allowed for system
--   SET LOCAL app.actor_label    = 'user:foo@bar';
--   SET LOCAL app.ip             = '1.2.3.4';
--   SET LOCAL app.user_agent     = 'Mozilla/...';

CREATE OR REPLACE FUNCTION public.session_text(key TEXT)
RETURNS TEXT LANGUAGE plpgsql STABLE AS $$
DECLARE
  v TEXT;
BEGIN
  BEGIN
    v := current_setting(key, TRUE);
  EXCEPTION WHEN OTHERS THEN
    v := NULL;
  END;
  IF v = '' THEN v := NULL; END IF;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.session_uuid(key TEXT)
RETURNS UUID LANGUAGE plpgsql STABLE AS $$
DECLARE
  v TEXT;
BEGIN
  v := public.session_text(key);
  IF v IS NULL THEN RETURN NULL; END IF;
  RETURN v::uuid;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END $$;

-- Generic logger used by triggers. Takes entity name + optional old/new pair.
CREATE OR REPLACE FUNCTION public.log_audit_event(
  p_tenant_id  UUID,
  p_entity     TEXT,
  p_entity_id  UUID,
  p_field      TEXT,
  p_old        TEXT,
  p_new        TEXT,
  p_reason     TEXT
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.audit_log (
    tenant_id, actor_id, actor_label, timestamp_utc,
    entity, entity_id, field, old_value, new_value, reason,
    ip, user_agent, result
  ) VALUES (
    p_tenant_id,
    public.session_uuid('app.actor_id'),
    public.session_text('app.actor_label'),
    now(),
    p_entity, p_entity_id, p_field, p_old, p_new, p_reason,
    NULLIF(public.session_text('app.ip'), '')::inet,
    public.session_text('app.user_agent'),
    'success'
  );
END $$;

-- ---- price_versions --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_price_versions_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  prev_amount BIGINT;
BEGIN
  IF NEW.previous_version_id IS NOT NULL THEN
    SELECT amount_cents INTO prev_amount
    FROM public.price_versions
    WHERE id = NEW.previous_version_id;
  END IF;

  PERFORM public.log_audit_event(
    NEW.tenant_id,
    'price_versions',
    NEW.id,
    'amount_cents',
    COALESCE(prev_amount::text, NULL),
    NEW.amount_cents::text,
    NEW.reason
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS price_versions_audit ON public.price_versions;
CREATE TRIGGER price_versions_audit
  AFTER INSERT ON public.price_versions
  FOR EACH ROW EXECUTE FUNCTION public.audit_price_versions_insert();

-- ---- doctor_commission_history --------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_commission_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  prev_pct INTEGER;
BEGIN
  SELECT percentage_bps INTO prev_pct
  FROM public.doctor_commission_history
  WHERE tenant_id = NEW.tenant_id
    AND doctor_id = NEW.doctor_id
    AND valid_from < NEW.valid_from
  ORDER BY valid_from DESC, created_at DESC
  LIMIT 1;

  PERFORM public.log_audit_event(
    NEW.tenant_id,
    'doctor_commission_history',
    NEW.id,
    'percentage_bps',
    COALESCE(prev_pct::text, NULL),
    NEW.percentage_bps::text,
    NEW.reason
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS doctor_commission_audit ON public.doctor_commission_history;
CREATE TRIGGER doctor_commission_audit
  AFTER INSERT ON public.doctor_commission_history
  FOR EACH ROW EXECUTE FUNCTION public.audit_commission_insert();

-- ---- procedures ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_procedures_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'procedures', NEW.id, NULL, NULL, NEW.tuss_code, 'created'
    );
  ELSIF TG_OP = 'UPDATE' AND NEW.active IS DISTINCT FROM OLD.active THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'procedures', NEW.id, 'active', OLD.active::text, NEW.active::text, 'toggle-active'
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS procedures_audit ON public.procedures;
CREATE TRIGGER procedures_audit
  AFTER INSERT OR UPDATE ON public.procedures
  FOR EACH ROW EXECUTE FUNCTION public.audit_procedures_change();

-- ---- health_plans ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_health_plans_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'health_plans', NEW.id, NULL, NULL, NEW.name, 'created'
    );
  ELSIF TG_OP = 'UPDATE' AND NEW.active IS DISTINCT FROM OLD.active THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'health_plans', NEW.id, 'active', OLD.active::text, NEW.active::text, 'toggle-active'
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS health_plans_audit ON public.health_plans;
CREATE TRIGGER health_plans_audit
  AFTER INSERT OR UPDATE ON public.health_plans
  FOR EACH ROW EXECUTE FUNCTION public.audit_health_plans_change();

-- ---- appointments ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_appointments_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.log_audit_event(
    NEW.tenant_id,
    'appointments',
    NEW.id,
    'frozen_amount_cents',
    NULL,
    NEW.frozen_amount_cents::text,
    'appointment-created'
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS appointments_audit ON public.appointments;
CREATE TRIGGER appointments_audit
  AFTER INSERT ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.audit_appointments_insert();

-- ---- appointment_reversals ------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_reversals_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.log_audit_event(
    NEW.tenant_id,
    'appointment_reversals',
    NEW.id,
    'reversal_amount_cents',
    NULL,
    NEW.reversal_amount_cents::text,
    NEW.reason
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS appointment_reversals_audit ON public.appointment_reversals;
CREATE TRIGGER appointment_reversals_audit
  AFTER INSERT ON public.appointment_reversals
  FOR EACH ROW EXECUTE FUNCTION public.audit_reversals_insert();

-- ---- patients: audit only *which* field changed, never values (PII) -------
CREATE OR REPLACE FUNCTION public.audit_patients_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'patients', NEW.id, NULL, NULL, '[created]', 'patient-upserted'
    );
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'patients', NEW.id,
      'pii_fields', '[redacted-old]', '[redacted-new]', 'patient-updated'
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS patients_audit ON public.patients;
CREATE TRIGGER patients_audit
  AFTER INSERT OR UPDATE ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.audit_patients_change();

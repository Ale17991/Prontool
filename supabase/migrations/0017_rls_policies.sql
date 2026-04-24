-- T029: RLS policies. Tenant isolation is mandatory on every policy;
-- role gating is additional where FRs require it.

-- Helper: reads tenant_id claim from JWT. Returns NULL if absent.
CREATE OR REPLACE FUNCTION public.jwt_tenant_id()
RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT NULLIF(auth.jwt() ->> 'tenant_id', '')::uuid
$$;

CREATE OR REPLACE FUNCTION public.jwt_role()
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT COALESCE(auth.jwt() ->> 'role', '')
$$;

-- ---- tenants: user sees their own tenant row(s) ---------------------------
DROP POLICY IF EXISTS tenants_select_own ON public.tenants;
CREATE POLICY tenants_select_own ON public.tenants
  FOR SELECT
  USING (id = public.jwt_tenant_id());

-- ---- user_tenants: user sees their own memberships ------------------------
DROP POLICY IF EXISTS user_tenants_select_own ON public.user_tenants;
CREATE POLICY user_tenants_select_own ON public.user_tenants
  FOR SELECT
  USING (user_id = auth.uid());

-- ---- tenant_ghl_config: admin only ----------------------------------------
DROP POLICY IF EXISTS tenant_ghl_config_admin_rw ON public.tenant_ghl_config;
CREATE POLICY tenant_ghl_config_admin_rw ON public.tenant_ghl_config
  FOR ALL
  USING (tenant_id = public.jwt_tenant_id() AND public.jwt_role() = 'admin')
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() = 'admin');

-- ---- procedures -----------------------------------------------------------
DROP POLICY IF EXISTS procedures_read ON public.procedures;
CREATE POLICY procedures_read ON public.procedures
  FOR SELECT USING (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS procedures_admin_write ON public.procedures;
CREATE POLICY procedures_admin_write ON public.procedures
  FOR INSERT WITH CHECK (
    tenant_id = public.jwt_tenant_id() AND public.jwt_role() = 'admin'
  );

DROP POLICY IF EXISTS procedures_admin_update ON public.procedures;
CREATE POLICY procedures_admin_update ON public.procedures
  FOR UPDATE USING (
    tenant_id = public.jwt_tenant_id() AND public.jwt_role() = 'admin'
  );

-- ---- health_plans ---------------------------------------------------------
DROP POLICY IF EXISTS health_plans_read ON public.health_plans;
CREATE POLICY health_plans_read ON public.health_plans
  FOR SELECT USING (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS health_plans_admin_insert ON public.health_plans;
CREATE POLICY health_plans_admin_insert ON public.health_plans
  FOR INSERT WITH CHECK (
    tenant_id = public.jwt_tenant_id() AND public.jwt_role() = 'admin'
  );

DROP POLICY IF EXISTS health_plans_admin_update ON public.health_plans;
CREATE POLICY health_plans_admin_update ON public.health_plans
  FOR UPDATE USING (
    tenant_id = public.jwt_tenant_id() AND public.jwt_role() = 'admin'
  );

-- ---- doctors --------------------------------------------------------------
DROP POLICY IF EXISTS doctors_read ON public.doctors;
CREATE POLICY doctors_read ON public.doctors
  FOR SELECT USING (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS doctors_admin_insert ON public.doctors;
CREATE POLICY doctors_admin_insert ON public.doctors
  FOR INSERT WITH CHECK (
    tenant_id = public.jwt_tenant_id() AND public.jwt_role() = 'admin'
  );

DROP POLICY IF EXISTS doctors_admin_update ON public.doctors;
CREATE POLICY doctors_admin_update ON public.doctors
  FOR UPDATE USING (
    tenant_id = public.jwt_tenant_id() AND public.jwt_role() = 'admin'
  );

-- ---- doctor_commission_history (append-only; admin insert only) -----------
DROP POLICY IF EXISTS commission_read ON public.doctor_commission_history;
CREATE POLICY commission_read ON public.doctor_commission_history
  FOR SELECT USING (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS commission_admin_insert ON public.doctor_commission_history;
CREATE POLICY commission_admin_insert ON public.doctor_commission_history
  FOR INSERT WITH CHECK (
    tenant_id = public.jwt_tenant_id() AND public.jwt_role() = 'admin'
  );

-- ---- price_versions (append-only; admin insert only) ----------------------
DROP POLICY IF EXISTS price_versions_read ON public.price_versions;
CREATE POLICY price_versions_read ON public.price_versions
  FOR SELECT USING (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS price_versions_admin_insert ON public.price_versions;
CREATE POLICY price_versions_admin_insert ON public.price_versions
  FOR INSERT WITH CHECK (
    tenant_id = public.jwt_tenant_id() AND public.jwt_role() = 'admin'
  );

-- ---- patients (all tenant roles read; writes go through service-role) ----
DROP POLICY IF EXISTS patients_read ON public.patients;
CREATE POLICY patients_read ON public.patients
  FOR SELECT USING (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() IN ('admin', 'financeiro', 'recepcionista', 'profissional_saude')
  );

-- Upserts to patients are only done by the worker via service-role,
-- which bypasses RLS. Tenant users cannot create/modify patient rows.

-- ---- appointments ---------------------------------------------------------
DROP POLICY IF EXISTS appointments_read ON public.appointments;
CREATE POLICY appointments_read ON public.appointments
  FOR SELECT USING (tenant_id = public.jwt_tenant_id());

-- Appointment inserts happen only through the worker (service-role).

-- ---- appointment_reversals (admin + financeiro) ---------------------------
DROP POLICY IF EXISTS reversals_read ON public.appointment_reversals;
CREATE POLICY reversals_read ON public.appointment_reversals
  FOR SELECT USING (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS reversals_admin_fin_insert ON public.appointment_reversals;
CREATE POLICY reversals_admin_fin_insert ON public.appointment_reversals
  FOR INSERT WITH CHECK (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() IN ('admin', 'financeiro')
  );

-- ---- raw_webhook_events (admin read for DLQ browsing) ---------------------
DROP POLICY IF EXISTS raw_events_read ON public.raw_webhook_events;
CREATE POLICY raw_events_read ON public.raw_webhook_events
  FOR SELECT USING (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() IN ('admin', 'financeiro')
  );

-- ---- webhook_event_transitions (same audience) ----------------------------
DROP POLICY IF EXISTS webhook_transitions_read ON public.webhook_event_transitions;
CREATE POLICY webhook_transitions_read ON public.webhook_event_transitions
  FOR SELECT USING (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() IN ('admin', 'financeiro')
  );

-- ---- alerts: admin + financeiro read; admin resolve ----------------------
DROP POLICY IF EXISTS alerts_read ON public.alerts;
CREATE POLICY alerts_read ON public.alerts
  FOR SELECT USING (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() IN ('admin', 'financeiro')
  );

DROP POLICY IF EXISTS alerts_admin_update ON public.alerts;
CREATE POLICY alerts_admin_update ON public.alerts
  FOR UPDATE USING (
    tenant_id = public.jwt_tenant_id() AND public.jwt_role() = 'admin'
  );

-- ---- alert_status_transitions --------------------------------------------
DROP POLICY IF EXISTS alert_transitions_read ON public.alert_status_transitions;
CREATE POLICY alert_transitions_read ON public.alert_status_transitions
  FOR SELECT USING (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() IN ('admin', 'financeiro')
  );

-- ---- audit_log (admin only) ----------------------------------------------
DROP POLICY IF EXISTS audit_log_admin_read ON public.audit_log;
CREATE POLICY audit_log_admin_read ON public.audit_log
  FOR SELECT USING (
    tenant_id = public.jwt_tenant_id() AND public.jwt_role() = 'admin'
  );

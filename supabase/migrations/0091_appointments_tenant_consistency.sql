-- 0091 — Fecha cross-tenant em create_step_with_appointment + trigger em
-- appointments validando consistência das FKs (E2).
--
-- Problema (0055:356-405): a RPC `create_step_with_appointment` aceita
-- p_tenant_id, p_patient_id, p_procedure_id, p_doctor_id, p_plan_id como
-- parâmetros independentes, sem checar:
--   1. caller jwt_tenant_id() == p_tenant_id (sem guard de auth);
--   2. FKs (patient, doctor, procedure, plan) pertencem ao mesmo tenant.
-- O handler JS (`createStepWithAppointment` em
-- src/lib/core/treatment-steps/create-with-appointment.ts:65-69) faz
-- `ensureBelongsToTenant`, mas isso só protege o caminho via API route.
-- A RPC tem GRANT EXECUTE TO authenticated → invocável direto via PostgREST.
--
-- Duas camadas de defesa:
--   A) `create_step_with_appointment` ganha guard de jwt (mesmo padrão E1/C3).
--   B) Trigger BEFORE INSERT em `appointments` valida que patient/doctor/
--      procedure/plan tenant_id == NEW.tenant_id. Protege qualquer caminho
--      de INSERT em appointments (não só a RPC) — service_role direto,
--      seeds, scripts futuros, etc.

-- =========================================================================
-- (a) Trigger BEFORE INSERT em appointments — tenant consistency das FKs
-- =========================================================================

CREATE OR REPLACE FUNCTION public.check_appointment_tenant_consistency()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_other_tenant UUID;
BEGIN
  -- patient
  SELECT tenant_id INTO v_other_tenant FROM public.patients WHERE id = NEW.patient_id;
  IF v_other_tenant IS NULL THEN
    RAISE EXCEPTION 'appointments: patient % nao encontrado.', NEW.patient_id
      USING ERRCODE = '23503';
  END IF;
  IF v_other_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'APPOINTMENT_TENANT_MISMATCH: appointment.tenant_id=% patient.tenant_id=%',
      NEW.tenant_id, v_other_tenant USING ERRCODE = '42501';
  END IF;

  -- doctor
  SELECT tenant_id INTO v_other_tenant FROM public.doctors WHERE id = NEW.doctor_id;
  IF v_other_tenant IS NULL THEN
    RAISE EXCEPTION 'appointments: doctor % nao encontrado.', NEW.doctor_id
      USING ERRCODE = '23503';
  END IF;
  IF v_other_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'APPOINTMENT_TENANT_MISMATCH: appointment.tenant_id=% doctor.tenant_id=%',
      NEW.tenant_id, v_other_tenant USING ERRCODE = '42501';
  END IF;

  -- procedure
  SELECT tenant_id INTO v_other_tenant FROM public.procedures WHERE id = NEW.procedure_id;
  IF v_other_tenant IS NULL THEN
    RAISE EXCEPTION 'appointments: procedure % nao encontrado.', NEW.procedure_id
      USING ERRCODE = '23503';
  END IF;
  IF v_other_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'APPOINTMENT_TENANT_MISMATCH: appointment.tenant_id=% procedure.tenant_id=%',
      NEW.tenant_id, v_other_tenant USING ERRCODE = '42501';
  END IF;

  -- plan: nullable após 0059 (particular). Só valida se preenchido.
  IF NEW.plan_id IS NOT NULL THEN
    SELECT tenant_id INTO v_other_tenant FROM public.health_plans WHERE id = NEW.plan_id;
    IF v_other_tenant IS NULL THEN
      RAISE EXCEPTION 'appointments: plan % nao encontrado.', NEW.plan_id
        USING ERRCODE = '23503';
    END IF;
    IF v_other_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'APPOINTMENT_TENANT_MISMATCH: appointment.tenant_id=% plan.tenant_id=%',
        NEW.tenant_id, v_other_tenant USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS appointments_tenant_consistency ON public.appointments;
CREATE TRIGGER appointments_tenant_consistency
  BEFORE INSERT ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.check_appointment_tenant_consistency();

-- =========================================================================
-- (b) create_step_with_appointment — guard jwt_tenant_id
-- =========================================================================

CREATE OR REPLACE FUNCTION public.create_step_with_appointment(
  p_tenant_id        UUID,
  p_patient_id       UUID,
  p_procedure_id     UUID,
  p_doctor_id        UUID,
  p_plan_id          UUID,
  p_appointment_at   TIMESTAMPTZ,
  p_duration_minutes INTEGER,
  p_title            TEXT,
  p_notes            TEXT,
  p_created_by       UUID,
  p_amount_cents     BIGINT,
  p_commission_bps   INTEGER,
  p_price_version_id UUID,
  p_commission_history_id UUID
) RETURNS TABLE (step_id UUID, appointment_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_appointment_id UUID;
  v_step_id        UUID;
  v_jwt_tenant     UUID;
  v_jwt_role       TEXT;
BEGIN
  v_jwt_tenant := public.jwt_tenant_id();
  v_jwt_role   := public.jwt_role();

  -- Tenant guard: exige claim presente E batendo, exceto service_role
  -- (caminho legítimo do handler /api/pacientes/[id]/etapas).
  IF v_jwt_role <> 'service_role'
     AND (v_jwt_tenant IS NULL OR v_jwt_tenant <> p_tenant_id) THEN
    RAISE EXCEPTION USING MESSAGE='TENANT_MISMATCH', ERRCODE='42501';
  END IF;

  -- O trigger check_appointment_tenant_consistency em appointments fecha
  -- o caso de FKs cross-tenant (patient, doctor, procedure, plan) — não
  -- precisamos validar aqui de novo.

  INSERT INTO public.appointments (
    tenant_id, patient_id, doctor_id, procedure_id, plan_id,
    source_price_version_id, source_commission_history_id,
    frozen_amount_cents, frozen_commission_bps,
    appointment_at, duration_minutes, source
  ) VALUES (
    p_tenant_id, p_patient_id, p_doctor_id, p_procedure_id, p_plan_id,
    p_price_version_id, p_commission_history_id,
    p_amount_cents, p_commission_bps,
    p_appointment_at, p_duration_minutes, 'manual'
  ) RETURNING id INTO v_appointment_id;

  INSERT INTO public.treatment_plan_steps (
    tenant_id, patient_id, procedure_id, plan_id,
    title, notes, scheduled_date, status, created_by, appointment_id
  ) VALUES (
    p_tenant_id, p_patient_id, p_procedure_id, p_plan_id,
    p_title, p_notes,
    (p_appointment_at AT TIME ZONE 'America/Sao_Paulo')::date,
    'pendente', p_created_by, v_appointment_id
  ) RETURNING id INTO v_step_id;

  RETURN QUERY SELECT v_step_id, v_appointment_id;
END $$;

NOTIFY pgrst, 'reload schema';

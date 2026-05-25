-- 0106 — Restaura `doctor_id` no INSERT de treatment_plan_steps dentro de
-- create_step_with_appointment.
--
-- Regressão: a migration 0056 adicionou `doctor_id` ao INSERT da step. A 0091
-- recriou a função (CREATE OR REPLACE) para introduzir o tenant guard via JWT,
-- mas ao reescrever o corpo OMITIU a coluna `doctor_id` — desde então a step
-- vinculada ao atendimento nascia com `doctor_id = NULL`. Sintoma:
-- treatment-step-appointment-link.spec.ts (a) falhando (doctor_id null) e, em
-- produção, etapas criadas junto com o atendimento sem profissional associado.
--
-- Esta migration recria a função idêntica à 0091 (mesmo guard, mesma assinatura,
-- mesmo cálculo de scheduled_date) apenas re-incluindo `doctor_id = p_doctor_id`.
-- Aditiva e idempotente (CREATE OR REPLACE).

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
    tenant_id, patient_id, procedure_id, plan_id, doctor_id,
    title, notes, scheduled_date, status, created_by, appointment_id
  ) VALUES (
    p_tenant_id, p_patient_id, p_procedure_id, p_plan_id, p_doctor_id,
    p_title, p_notes,
    (p_appointment_at AT TIME ZONE 'America/Sao_Paulo')::date,
    'pendente', p_created_by, v_appointment_id
  ) RETURNING id INTO v_step_id;

  RETURN QUERY SELECT v_step_id, v_appointment_id;
END $$;

GRANT EXECUTE ON FUNCTION public.create_step_with_appointment(
  UUID, UUID, UUID, UUID, UUID, TIMESTAMPTZ, INTEGER, TEXT, TEXT, UUID,
  BIGINT, INTEGER, UUID, UUID
) TO authenticated;

NOTIFY pgrst, 'reload schema';

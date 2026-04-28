-- 0056 — Follow-up da 0055 corrigindo dois pontos:
--
--   1. enforce_treatment_plan_step_mutability volta a incluir `doctor_id`
--      no whitelist de imutabilidade (foi removido inadvertidamente em 0055
--      apos a 0045 ja te-lo adicionado). Etapas legadas continuam mutaveis
--      em status/completed_at/completed_by + appointment_id (one-shot).
--
--   2. create_step_with_appointment passa a inserir doctor_id na
--      treatment_plan_steps. Sem ele, etapas criadas via RPC ficam com
--      doctor_id NULL e quebram a apresentacao do "Profissional responsavel"
--      no plano de tratamento.

CREATE OR REPLACE FUNCTION public.enforce_treatment_plan_step_mutability()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role', 'supabase_auth_admin') THEN
    RETURN NEW;
  END IF;

  -- appointment_id: one-shot link (so permite UPDATE quando OLD e NULL).
  IF NEW.appointment_id IS DISTINCT FROM OLD.appointment_id THEN
    IF OLD.appointment_id IS NOT NULL THEN
      RAISE EXCEPTION USING
        MESSAGE = 'treatment_plan_steps.appointment_id is immutable once set',
        ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.id             IS DISTINCT FROM OLD.id
     OR NEW.tenant_id      IS DISTINCT FROM OLD.tenant_id
     OR NEW.patient_id     IS DISTINCT FROM OLD.patient_id
     OR NEW.procedure_id   IS DISTINCT FROM OLD.procedure_id
     OR NEW.plan_id        IS DISTINCT FROM OLD.plan_id
     OR NEW.doctor_id      IS DISTINCT FROM OLD.doctor_id
     OR NEW.title          IS DISTINCT FROM OLD.title
     OR NEW.notes          IS DISTINCT FROM OLD.notes
     OR NEW.scheduled_date IS DISTINCT FROM OLD.scheduled_date
     OR NEW.created_by     IS DISTINCT FROM OLD.created_by
     OR NEW.created_at     IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING
      MESSAGE = 'treatment_plan_steps: only status/completed_at/completed_by/appointment_id (one-shot) are mutable',
      ERRCODE = '42501';
  END IF;

  RETURN NEW;
END $$;

-- Substitui create_step_with_appointment para incluir doctor_id no INSERT.
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
  v_step_id UUID;
BEGIN
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

-- 0106 — Restaura `doctor_id` no INSERT em `treatment_plan_steps` dentro
-- de `create_step_with_appointment`. Regressão silenciosa introduzida
-- pela 0091.
--
-- Cronologia:
--   - 0055 criou a RPC pela primeira vez (sem doctor_id na step).
--   - 0056 adicionou doctor_id no INSERT — fix para o "Profissional
--     responsavel" sumir do plano de tratamento.
--   - 0091 reescreveu a RPC focando em guard de jwt_tenant_id (defense
--     in depth contra invocação direta via PostgREST) e perdeu o
--     `doctor_id` no INSERT — mesmo padrão de regressão que já tinhamos
--     visto em 0101 sobrescrevendo a 0070.
--
-- Sintoma em producao: toda etapa criada via `/api/pacientes/[id]/etapas`
-- (que chama `createStepWithAppointment` -> esta RPC) ficava com
-- `doctor_id = NULL` na `treatment_plan_steps`, quebrando o display do
-- profissional responsavel no plano de tratamento.
--
-- Fix: reescreve a RPC mantendo o guard de jwt da 0091 E reinclui
-- `doctor_id` no INSERT em treatment_plan_steps (igual a 0056).
-- Idempotente — CREATE OR REPLACE com a MESMA assinatura.

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
  -- (caminho legítimo do handler /api/pacientes/[id]/etapas). Regra
  -- preservada da 0091.
  IF v_jwt_role <> 'service_role'
     AND (v_jwt_tenant IS NULL OR v_jwt_tenant <> p_tenant_id) THEN
    RAISE EXCEPTION USING MESSAGE='TENANT_MISMATCH', ERRCODE='42501';
  END IF;

  -- O trigger check_appointment_tenant_consistency (0091) já valida FKs
  -- cross-tenant em appointments — não duplica aqui.

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

  -- doctor_id RESTAURADO (regressão 0091 → fix 0106). Sem ele, o
  -- display do profissional responsavel no plano de tratamento fica
  -- vazio para toda etapa criada via RPC.
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

-- =========================================================================
-- Backfill das etapas afetadas pela regressão (criadas entre 0091 e 0106
-- com doctor_id IS NULL mas appointment_id vinculado). Para estas
-- conseguimos derivar o doctor correto do appointment ligado.
--
-- A migration roda como supabase_admin -> bypass dos triggers de
-- imutabilidade (enforce_treatment_plan_step_mutability libera
-- supabase_admin/service_role; ver 0056 linha 16).
-- =========================================================================

UPDATE public.treatment_plan_steps s
SET doctor_id = a.doctor_id
FROM public.appointments a
WHERE s.appointment_id = a.id
  AND s.doctor_id IS NULL
  AND a.doctor_id IS NOT NULL
  AND s.tenant_id = a.tenant_id;

NOTIFY pgrst, 'reload schema';

-- 0090 — Endurece guard de tenant em mark_appointment_realized (E1).
--
-- Antes (0055:325-339): `IF v_jwt_tenant IS NOT NULL AND v_jwt_tenant <> v_tenant_id`
-- — mesma falha que C3 nas RPCs da feature 013 (corrigida em 0085). Caller
-- autenticado SEM claim tenant_id (entre signup/onboarding, vínculo desativado,
-- tenant suspenso após 0089) passa direto. RPC tem GRANT EXECUTE TO authenticated
-- → invocável via PostgREST `/rest/v1/rpc/mark_appointment_realized`, fora do
-- handler que faz requireRole.
--
-- Agora: `IF v_jwt_role <> 'service_role' AND (v_jwt_tenant IS NULL OR
-- v_jwt_tenant <> v_tenant_id)` — exige claim presente E batendo, exceto
-- service_role (caminho legítimo do handler /api/atendimentos/[id]/realizado).

CREATE OR REPLACE FUNCTION public.mark_appointment_realized(
  p_appointment_id UUID,
  p_by UUID,
  p_reason TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id     UUID;
  v_completion_id UUID;
  v_jwt_tenant    UUID;
  v_jwt_role      TEXT;
BEGIN
  v_jwt_tenant := public.jwt_tenant_id();
  v_jwt_role   := public.jwt_role();

  SELECT tenant_id INTO v_tenant_id
    FROM public.appointments
   WHERE id = p_appointment_id;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'APPOINTMENT_NOT_FOUND', ERRCODE = '02000';
  END IF;

  -- Multi-tenant: exige claim presente E batendo, exceto service_role
  -- (que entra via handler já gated por requireRole).
  IF v_jwt_role <> 'service_role'
     AND (v_jwt_tenant IS NULL OR v_jwt_tenant <> v_tenant_id) THEN
    -- Mantém shape APPOINTMENT_NOT_FOUND para não vazar existência cross-tenant.
    RAISE EXCEPTION USING MESSAGE = 'APPOINTMENT_NOT_FOUND', ERRCODE = '02000';
  END IF;

  IF EXISTS (SELECT 1 FROM public.appointment_reversals WHERE appointment_id = p_appointment_id) THEN
    RAISE EXCEPTION USING MESSAGE = 'APPOINTMENT_REVERSED', ERRCODE = '23514';
  END IF;

  INSERT INTO public.appointment_completions
    (tenant_id, appointment_id, completed_by, source, reason)
  VALUES (v_tenant_id, p_appointment_id, p_by, 'manual', p_reason)
  RETURNING id INTO v_completion_id;

  RETURN v_completion_id;
END $$;

NOTIFY pgrst, 'reload schema';

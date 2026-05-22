-- 0099 — Cancelamento gera estorno automatico em CONFIRMADO ou ATIVO.
--
-- Regra de negocio: o estorno financeiro so' faz sentido quando o
-- paciente assumiu compromisso (confirmou via telefone) ou compareceu
-- (presenca confirmada). Cancelamento de atendimento meramente AGENDADO
-- (so' salvo, sem confirmacao) nao gera estorno porque nada foi
-- comprometido financeiramente do lado do paciente.
--
-- Antes (0096/0097): so' criava estorno se havia appointment_completions
-- (status='ativo'). Confirmado ficava sem estorno mesmo se cancelado.
--
-- Idempotente — CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.cancel_appointment(
  p_appointment_id UUID,
  p_by             UUID,
  p_reason         TEXT,
  p_notes          TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id       UUID;
  v_cancellation_id UUID;
  v_jwt_tenant      UUID;
  v_jwt_role        TEXT;
BEGIN
  v_jwt_tenant := public.jwt_tenant_id();
  v_jwt_role   := public.jwt_role();

  IF p_reason IS NULL OR p_reason NOT IN ('no_show', 'paciente_desmarcou', 'clinica_desmarcou', 'estornado', 'outro') THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_REASON', ERRCODE = '22023';
  END IF;

  SELECT tenant_id INTO v_tenant_id
    FROM public.appointments
   WHERE id = p_appointment_id;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'APPOINTMENT_NOT_FOUND', ERRCODE = '02000';
  END IF;

  IF v_jwt_role <> 'service_role'
     AND (v_jwt_tenant IS NULL OR v_jwt_tenant <> v_tenant_id) THEN
    RAISE EXCEPTION USING MESSAGE = 'APPOINTMENT_NOT_FOUND', ERRCODE = '02000';
  END IF;

  -- Estorno automatico: dispara quando o atendimento esta em CONFIRMADO
  -- (paciente avisou que vem) ou ATIVO (presenca confirmada/realizado),
  -- e ainda nao foi estornado. Atendimento meramente AGENDADO (sem
  -- confirmation nem completion) NAO gera estorno. Atendimentos
  -- gratuitos (frozen=0) tambem pulam — a constraint
  -- reversal_amount_cents < 0 nao permite valor zero.
  IF NOT EXISTS (
    SELECT 1 FROM public.appointment_reversals
     WHERE appointment_id = p_appointment_id
  )
  AND (
    EXISTS (SELECT 1 FROM public.appointment_confirmations WHERE appointment_id = p_appointment_id)
    OR EXISTS (SELECT 1 FROM public.appointment_completions WHERE appointment_id = p_appointment_id)
  ) THEN
    INSERT INTO public.appointment_reversals
      (tenant_id, appointment_id, reversal_amount_cents, reason, created_by)
    SELECT
      a.tenant_id,
      a.id,
      -a.frozen_amount_cents,
      'cancelamento: ' || p_reason || COALESCE(' — ' || p_notes, ''),
      p_by
      FROM public.appointments a
     WHERE a.id = p_appointment_id
       AND a.frozen_amount_cents > 0
    ON CONFLICT (tenant_id, appointment_id) DO NOTHING;
  END IF;

  INSERT INTO public.appointment_cancellations
    (tenant_id, appointment_id, cancelled_by, reason, notes)
  VALUES (v_tenant_id, p_appointment_id, p_by, p_reason, p_notes)
  ON CONFLICT (tenant_id, appointment_id) DO NOTHING
  RETURNING id INTO v_cancellation_id;

  IF v_cancellation_id IS NULL THEN
    SELECT id INTO v_cancellation_id
      FROM public.appointment_cancellations
     WHERE appointment_id = p_appointment_id;
  END IF;

  RETURN v_cancellation_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.cancel_appointment(UUID, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.cancel_appointment(UUID, UUID, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

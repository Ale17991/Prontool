-- 0097 — Atualiza appointment_cancellations / cancel_appointment:
--   (a) Acrescenta 'estornado' aos motivos validos
--   (b) Reescreve cancel_appointment com a logica completa de auto-estorno
--       em atendimentos ativos. Idempotente para ambientes onde a 0096 foi
--       aplicada antes desta atualizacao consolidada.

-- =========================================================================
-- (a) CHECK constraint — incluir 'estornado'
-- =========================================================================
ALTER TABLE public.appointment_cancellations
  DROP CONSTRAINT IF EXISTS appointment_cancellations_reason_check;

ALTER TABLE public.appointment_cancellations
  ADD CONSTRAINT appointment_cancellations_reason_check
  CHECK (reason IN ('no_show', 'paciente_desmarcou', 'clinica_desmarcou', 'estornado', 'outro'));

-- =========================================================================
-- (b) cancel_appointment — versao consolidada com auto-estorno
-- =========================================================================
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

  -- Cancelamento e' permitido em qualquer estado nao terminal:
  --   agendado, confirmado, ativo (realizado), estornado.
  -- Quando ativo (realizado mas nao estornado), criamos o estorno
  -- automaticamente — caso de uso: paciente compareceu, foi registrado,
  -- mas precisa ser revertido como no-show ou desmarcacao tardia.
  -- Pulamos o estorno automatico se o atendimento e' gratuito
  -- (frozen_amount_cents = 0) — a constraint reversal_amount_cents < 0
  -- nao permitiria, e nao ha o que reverter financeiramente.
  IF EXISTS (
    SELECT 1
      FROM public.appointment_completions c
     WHERE c.appointment_id = p_appointment_id
       AND NOT EXISTS (
         SELECT 1 FROM public.appointment_reversals r WHERE r.appointment_id = p_appointment_id
       )
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

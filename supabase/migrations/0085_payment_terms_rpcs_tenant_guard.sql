-- 0085 — Endurece guards de tenant nas 3 RPCs introduzidas em 0084.
--
-- Antes: `IF v_jwt_tenant IS NOT NULL AND v_jwt_tenant <> p_tenant_id THEN RAISE`
-- permitia caller autenticado SEM claim `tenant_id` (recém-cadastrado,
-- entre signup e onboarding, ou claim removida por desativação) chamar a
-- RPC pra qualquer tenant. As 3 funções têm GRANT EXECUTE TO authenticated.
--
-- Agora: `IS NULL OR <> p_tenant_id` — exige claim presente E batendo.
-- Ainda permite chamada via service_role (jwt_tenant_id() retorna NULL),
-- mas service_role é gated por requireRole no Route Handler.
--
-- ATENÇÃO: As RPCs também são alcançáveis via service_role bypass de RLS;
-- nesse caminho v_jwt_tenant=NULL é caso legítimo. Para distinguir, usamos
-- jwt_role() = 'service_role' como passe — alinhado com a checagem que já
-- existia em record_payment_terms_change linha 436.

CREATE OR REPLACE FUNCTION public.record_payment_terms_change(
  p_tenant_id             UUID,
  p_doctor_id             UUID,
  p_payment_mode          public.payment_mode,
  p_percentage_bps        INTEGER,
  p_monthly_amount_cents  BIGINT,
  p_billing_day           SMALLINT,
  p_liberal_default_cents BIGINT,
  p_valid_from            DATE,
  p_reason                TEXT,
  p_actor                 UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_new_id     UUID;
  v_jwt_tenant UUID;
  v_jwt_role   TEXT;
BEGIN
  v_jwt_tenant := public.jwt_tenant_id();
  v_jwt_role   := public.jwt_role();

  -- Tenant guard: exige claim presente E batendo, exceto para service_role
  -- (caminho legítimo de API route que já passou requireRole).
  IF v_jwt_role <> 'service_role' AND (v_jwt_tenant IS NULL OR v_jwt_tenant <> p_tenant_id) THEN
    RAISE EXCEPTION USING MESSAGE='TENANT_MISMATCH', ERRCODE='42501';
  END IF;

  -- Role guard (mantido de 0084).
  IF v_jwt_role IS NOT NULL
     AND v_jwt_role <> ''
     AND v_jwt_role <> 'admin'
     AND v_jwt_role <> 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE='FORBIDDEN_ROLE', ERRCODE='42501';
  END IF;

  IF p_valid_from > CURRENT_DATE THEN
    RAISE EXCEPTION USING MESSAGE='VALID_FROM_FUTURE', ERRCODE='22023';
  END IF;

  INSERT INTO public.doctor_payment_terms_history (
    tenant_id, doctor_id, payment_mode, percentage_bps,
    monthly_amount_cents, billing_day, liberal_default_cents,
    valid_from, reason, created_by
  ) VALUES (
    p_tenant_id, p_doctor_id, p_payment_mode, p_percentage_bps,
    p_monthly_amount_cents, p_billing_day, p_liberal_default_cents,
    p_valid_from, p_reason, p_actor
  ) RETURNING id INTO v_new_id;

  UPDATE public.doctors
     SET payment_mode = p_payment_mode
   WHERE id = p_doctor_id AND tenant_id = p_tenant_id;

  RETURN v_new_id;
END $$;

CREATE OR REPLACE FUNCTION public.attach_assistant_to_appointment(
  p_appointment_id      UUID,
  p_assistant_doctor_id UUID,
  p_amount_cents        BIGINT,
  p_actor               UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant_id  UUID;
  v_jwt_tenant UUID;
  v_jwt_role   TEXT;
  v_new_id     UUID;
BEGIN
  v_jwt_tenant := public.jwt_tenant_id();
  v_jwt_role   := public.jwt_role();

  SELECT tenant_id INTO v_tenant_id FROM public.appointments WHERE id = p_appointment_id;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE='APPOINTMENT_NOT_FOUND', ERRCODE='02000';
  END IF;

  -- Tenant guard reforçado (vs 0084): exige claim presente E batendo,
  -- exceto service_role. Sem essa restrição, usuário autenticado sem
  -- claim podia anexar assistente em qualquer appointment.
  IF v_jwt_role <> 'service_role' AND (v_jwt_tenant IS NULL OR v_jwt_tenant <> v_tenant_id) THEN
    -- Mantém shape de erro APPOINTMENT_NOT_FOUND para não vazar existência
    -- cross-tenant (alinhado com 0084).
    RAISE EXCEPTION USING MESSAGE='APPOINTMENT_NOT_FOUND', ERRCODE='02000';
  END IF;

  IF EXISTS (SELECT 1 FROM public.appointment_reversals WHERE appointment_id = p_appointment_id) THEN
    RAISE EXCEPTION USING MESSAGE='APPOINTMENT_REVERSED', ERRCODE='23514';
  END IF;

  INSERT INTO public.appointment_assistants (
    tenant_id, appointment_id, assistant_doctor_id, frozen_amount_cents, created_by
  ) VALUES (
    v_tenant_id, p_appointment_id, p_assistant_doctor_id, p_amount_cents, p_actor
  ) RETURNING id INTO v_new_id;

  RETURN v_new_id;
END $$;

CREATE OR REPLACE FUNCTION public.remove_appointment_assistant(
  p_id    UUID,
  p_actor UUID
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant_id  UUID;
  v_jwt_tenant UUID;
  v_jwt_role   TEXT;
BEGIN
  v_jwt_tenant := public.jwt_tenant_id();
  v_jwt_role   := public.jwt_role();

  SELECT tenant_id INTO v_tenant_id FROM public.appointment_assistants WHERE id = p_id;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE='ASSISTANT_NOT_FOUND', ERRCODE='02000';
  END IF;

  IF v_jwt_role <> 'service_role' AND (v_jwt_tenant IS NULL OR v_jwt_tenant <> v_tenant_id) THEN
    RAISE EXCEPTION USING MESSAGE='ASSISTANT_NOT_FOUND', ERRCODE='02000';
  END IF;

  UPDATE public.appointment_assistants
     SET removed_at = now(), removed_by = p_actor
   WHERE id = p_id AND removed_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE='ASSISTANT_ALREADY_REMOVED', ERRCODE='23514';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

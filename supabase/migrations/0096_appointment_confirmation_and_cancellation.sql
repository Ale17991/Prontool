-- 0096 — Confirmacao + cancelamento de atendimentos.
--
-- Estados de um atendimento (effective_status):
--   estornado   (existe row em appointment_reversals)          -- highest priority
--   cancelado   (existe row em appointment_cancellations)
--   ativo       (existe row em appointment_completions)        -- = "realizado"
--   confirmado  (existe row em appointment_confirmations)
--   agendado    (default)
--
-- Mesmo padrao das tabelas existentes: append-only, RLS read-only por tenant,
-- INSERT controlado via RPCs SECURITY DEFINER. Audit via log_audit_event.

-- =========================================================================
-- (a) appointment_confirmations — paciente avisou que vira
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.appointment_confirmations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  appointment_id  UUID NOT NULL REFERENCES public.appointments(id) ON DELETE RESTRICT,
  confirmed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_by    UUID NOT NULL,
  notes           TEXT,
  UNIQUE (tenant_id, appointment_id)
);

CREATE INDEX IF NOT EXISTS appointment_confirmations_tenant_idx
  ON public.appointment_confirmations (tenant_id, confirmed_at DESC);

ALTER TABLE public.appointment_confirmations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS appointment_confirmations_read ON public.appointment_confirmations;
CREATE POLICY appointment_confirmations_read ON public.appointment_confirmations
  FOR SELECT USING (tenant_id = public.jwt_tenant_id());

REVOKE INSERT, UPDATE, DELETE ON public.appointment_confirmations FROM authenticated;
GRANT SELECT ON public.appointment_confirmations TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_appointment_confirmation_immutability()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role', 'supabase_auth_admin') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'appointment_confirmations is append-only';
END $$;

DROP TRIGGER IF EXISTS appointment_confirmations_immutable ON public.appointment_confirmations;
CREATE TRIGGER appointment_confirmations_immutable
  BEFORE UPDATE OR DELETE ON public.appointment_confirmations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_appointment_confirmation_immutability();

CREATE OR REPLACE FUNCTION public.audit_appointment_confirmation_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.log_audit_event(
    NEW.tenant_id,
    'appointments',
    NEW.appointment_id,
    'effective_status',
    'agendado',
    'confirmado',
    COALESCE('notes=' || NEW.notes, NULL)
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS audit_appointment_confirmation_change ON public.appointment_confirmations;
CREATE TRIGGER audit_appointment_confirmation_change
  AFTER INSERT ON public.appointment_confirmations
  FOR EACH ROW EXECUTE FUNCTION public.audit_appointment_confirmation_change();

-- =========================================================================
-- (b) appointment_cancellations — agendamento cancelado (no-show ou outro)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.appointment_cancellations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  appointment_id  UUID NOT NULL REFERENCES public.appointments(id) ON DELETE RESTRICT,
  cancelled_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_by    UUID NOT NULL,
  reason          TEXT NOT NULL CHECK (reason IN ('no_show', 'paciente_desmarcou', 'clinica_desmarcou', 'outro')),
  notes           TEXT,
  UNIQUE (tenant_id, appointment_id)
);

CREATE INDEX IF NOT EXISTS appointment_cancellations_tenant_idx
  ON public.appointment_cancellations (tenant_id, cancelled_at DESC);

ALTER TABLE public.appointment_cancellations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS appointment_cancellations_read ON public.appointment_cancellations;
CREATE POLICY appointment_cancellations_read ON public.appointment_cancellations
  FOR SELECT USING (tenant_id = public.jwt_tenant_id());

REVOKE INSERT, UPDATE, DELETE ON public.appointment_cancellations FROM authenticated;
GRANT SELECT ON public.appointment_cancellations TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_appointment_cancellation_immutability()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role', 'supabase_auth_admin') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'appointment_cancellations is append-only';
END $$;

DROP TRIGGER IF EXISTS appointment_cancellations_immutable ON public.appointment_cancellations;
CREATE TRIGGER appointment_cancellations_immutable
  BEFORE UPDATE OR DELETE ON public.appointment_cancellations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_appointment_cancellation_immutability();

CREATE OR REPLACE FUNCTION public.audit_appointment_cancellation_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.log_audit_event(
    NEW.tenant_id,
    'appointments',
    NEW.appointment_id,
    'effective_status',
    'agendado',
    'cancelado',
    'reason=' || NEW.reason || COALESCE(';notes=' || NEW.notes, '')
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS audit_appointment_cancellation_change ON public.appointment_cancellations;
CREATE TRIGGER audit_appointment_cancellation_change
  AFTER INSERT ON public.appointment_cancellations
  FOR EACH ROW EXECUTE FUNCTION public.audit_appointment_cancellation_change();

-- Cancelamento libera slot lock (mesma logica do estorno) para permitir
-- reagendar no mesmo horario.
CREATE OR REPLACE FUNCTION public.release_slot_lock_on_cancellation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.appointment_slot_locks
   WHERE appointment_id = NEW.appointment_id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS appointment_cancellations_release_slot_lock ON public.appointment_cancellations;
CREATE TRIGGER appointment_cancellations_release_slot_lock
  AFTER INSERT ON public.appointment_cancellations
  FOR EACH ROW EXECUTE FUNCTION public.release_slot_lock_on_cancellation();

-- =========================================================================
-- (c) View appointments_effective recriada — agora com 'confirmado' e 'cancelado'
--     + tambem captura colunas adicionadas apos 0055 (ex.: observacoes da 0057).
-- =========================================================================
DROP VIEW IF EXISTS public.appointments_effective;
CREATE VIEW public.appointments_effective AS
SELECT
  a.*,
  CASE
    WHEN r.id  IS NOT NULL THEN 'estornado'
    WHEN x.id  IS NOT NULL THEN 'cancelado'
    WHEN c.id  IS NOT NULL THEN 'ativo'
    WHEN cf.id IS NOT NULL THEN 'confirmado'
    ELSE                        'agendado'
  END                                                                 AS effective_status,
  (a.frozen_amount_cents + COALESCE(r.reversal_amount_cents, 0))      AS net_amount_cents,
  (
    (a.frozen_amount_cents + COALESCE(r.reversal_amount_cents, 0))
    * a.frozen_commission_bps / 10000
  )                                                                    AS net_commission_cents,
  r.id           AS reversal_id,
  r.created_at   AS reversed_at,
  c.id           AS completion_id,
  c.completed_at,
  cf.id          AS confirmation_id,
  cf.confirmed_at,
  x.id           AS cancellation_id,
  x.cancelled_at,
  x.reason       AS cancellation_reason,
  (a.appointment_at + COALESCE(a.duration_minutes, 30) * interval '1 minute') AS appointment_ends_at
FROM public.appointments a
LEFT JOIN public.appointment_reversals      r  ON r.appointment_id  = a.id
LEFT JOIN public.appointment_completions    c  ON c.appointment_id  = a.id
LEFT JOIN public.appointment_confirmations  cf ON cf.appointment_id = a.id
LEFT JOIN public.appointment_cancellations  x  ON x.appointment_id  = a.id;

ALTER VIEW IF EXISTS public.appointments_effective SET (security_invoker = true);

-- =========================================================================
-- (d) RPC confirm_appointment(p_appointment_id, p_notes)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.confirm_appointment(
  p_appointment_id UUID,
  p_by             UUID,
  p_notes          TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id      UUID;
  v_confirmation_id UUID;
  v_jwt_tenant     UUID;
  v_jwt_role       TEXT;
BEGIN
  v_jwt_tenant := public.jwt_tenant_id();
  v_jwt_role   := public.jwt_role();

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

  -- Estados terminais bloqueiam confirmacao.
  IF EXISTS (SELECT 1 FROM public.appointment_reversals     WHERE appointment_id = p_appointment_id) THEN
    RAISE EXCEPTION USING MESSAGE = 'APPOINTMENT_REVERSED',  ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.appointment_cancellations WHERE appointment_id = p_appointment_id) THEN
    RAISE EXCEPTION USING MESSAGE = 'APPOINTMENT_CANCELLED', ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.appointment_completions   WHERE appointment_id = p_appointment_id) THEN
    RAISE EXCEPTION USING MESSAGE = 'APPOINTMENT_REALIZED',  ERRCODE = '23514';
  END IF;

  INSERT INTO public.appointment_confirmations
    (tenant_id, appointment_id, confirmed_by, notes)
  VALUES (v_tenant_id, p_appointment_id, p_by, p_notes)
  ON CONFLICT (tenant_id, appointment_id) DO NOTHING
  RETURNING id INTO v_confirmation_id;

  -- Se ja existia (ON CONFLICT DO NOTHING), retorna o id existente (idempotente).
  IF v_confirmation_id IS NULL THEN
    SELECT id INTO v_confirmation_id
      FROM public.appointment_confirmations
     WHERE appointment_id = p_appointment_id;
  END IF;

  RETURN v_confirmation_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.confirm_appointment(UUID, UUID, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.confirm_appointment(UUID, UUID, TEXT) TO authenticated;

-- =========================================================================
-- (e) RPC cancel_appointment(p_appointment_id, p_reason, p_notes)
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

  IF p_reason IS NULL OR p_reason NOT IN ('no_show', 'paciente_desmarcou', 'clinica_desmarcou', 'outro') THEN
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

  -- Estados terminais bloqueiam cancelamento.
  IF EXISTS (SELECT 1 FROM public.appointment_reversals   WHERE appointment_id = p_appointment_id) THEN
    RAISE EXCEPTION USING MESSAGE = 'APPOINTMENT_REVERSED', ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.appointment_completions WHERE appointment_id = p_appointment_id) THEN
    RAISE EXCEPTION USING MESSAGE = 'APPOINTMENT_REALIZED', ERRCODE = '23514';
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

-- =========================================================================
-- (f) Atualiza mark_appointment_realized para bloquear se ja cancelado.
--     (manter shape identico — somente acrescenta um check)
-- =========================================================================
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

  IF v_jwt_role <> 'service_role'
     AND (v_jwt_tenant IS NULL OR v_jwt_tenant <> v_tenant_id) THEN
    RAISE EXCEPTION USING MESSAGE = 'APPOINTMENT_NOT_FOUND', ERRCODE = '02000';
  END IF;

  IF EXISTS (SELECT 1 FROM public.appointment_reversals     WHERE appointment_id = p_appointment_id) THEN
    RAISE EXCEPTION USING MESSAGE = 'APPOINTMENT_REVERSED',  ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.appointment_cancellations WHERE appointment_id = p_appointment_id) THEN
    RAISE EXCEPTION USING MESSAGE = 'APPOINTMENT_CANCELLED', ERRCODE = '23514';
  END IF;

  INSERT INTO public.appointment_completions
    (tenant_id, appointment_id, completed_by, source, reason)
  VALUES (v_tenant_id, p_appointment_id, p_by, 'manual', p_reason)
  ON CONFLICT (tenant_id, appointment_id) DO NOTHING
  RETURNING id INTO v_completion_id;

  IF v_completion_id IS NULL THEN
    SELECT id INTO v_completion_id
      FROM public.appointment_completions
     WHERE appointment_id = p_appointment_id;
  END IF;

  RETURN v_completion_id;
END $$;

NOTIFY pgrst, 'reload schema';

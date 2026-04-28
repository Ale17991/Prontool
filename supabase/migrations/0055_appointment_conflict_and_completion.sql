-- 0055 — Feature 005: Integracao agenda x plano + conflito de horario.
--
-- Esta migration consolida:
--   (a) extensao btree_gist para EXCLUDE multi-coluna com UUID =
--   (b) tabela appointment_completions (append-only, status 'realizado')
--   (c) tabela appointment_slot_locks (indice derivado, EXCLUDE de overlap)
--   (d) ALTER em treatment_plan_steps adicionando appointment_id (one-shot)
--   (e) triggers de slot lock create/release
--   (f) triggers de status sync bidirecional step <-> appointment
--   (g) funcoes RPC mark_appointment_realized e create_step_with_appointment
--   (h) view appointments_effective recriada com 3-source CASE
--   (i) backfill de slot_locks para atendimentos existentes ativos

-- =========================================================================
-- (a) Extensao btree_gist
-- =========================================================================
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

-- =========================================================================
-- (b) appointment_completions — append-only "atendimento realizado"
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.appointment_completions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  appointment_id  UUID NOT NULL REFERENCES public.appointments(id) ON DELETE RESTRICT,
  completed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_by    UUID NOT NULL,
  source          TEXT NOT NULL CHECK (source IN ('plan_step', 'manual')),
  reason          TEXT,
  UNIQUE (tenant_id, appointment_id)
);

CREATE INDEX IF NOT EXISTS appointment_completions_tenant_idx
  ON public.appointment_completions (tenant_id, completed_at DESC);

ALTER TABLE public.appointment_completions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS appointment_completions_read ON public.appointment_completions;
CREATE POLICY appointment_completions_read ON public.appointment_completions
  FOR SELECT USING (tenant_id = public.jwt_tenant_id());

-- INSERT controlado via service_role / RPC; sem policy de INSERT para authenticated.
REVOKE INSERT, UPDATE, DELETE ON public.appointment_completions FROM authenticated;
GRANT SELECT ON public.appointment_completions TO authenticated;

-- Imutabilidade
CREATE OR REPLACE FUNCTION public.enforce_appointment_completion_immutability()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role', 'supabase_auth_admin') THEN
    -- service-role pode mexer (necessario para triggers SECURITY DEFINER).
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'appointment_completions is append-only';
END $$;

DROP TRIGGER IF EXISTS appointment_completions_immutable ON public.appointment_completions;
CREATE TRIGGER appointment_completions_immutable
  BEFORE UPDATE OR DELETE ON public.appointment_completions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_appointment_completion_immutability();

-- Audit (Principio II)
CREATE OR REPLACE FUNCTION public.audit_appointment_completion_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.log_audit_event(
    NEW.tenant_id,
    'appointments',
    NEW.appointment_id,
    'effective_status',
    'agendado',
    'ativo',
    'completion_source=' || NEW.source || COALESCE(';reason=' || NEW.reason, '')
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS audit_appointment_completion_change ON public.appointment_completions;
CREATE TRIGGER audit_appointment_completion_change
  AFTER INSERT ON public.appointment_completions
  FOR EACH ROW EXECUTE FUNCTION public.audit_appointment_completion_change();

-- =========================================================================
-- (c) appointment_slot_locks — indice derivado de slots ocupados
--     com EXCLUDE constraint que e o veto autoritativo de conflito.
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.appointment_slot_locks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  doctor_id       UUID NOT NULL REFERENCES public.doctors(id) ON DELETE RESTRICT,
  appointment_id  UUID NOT NULL UNIQUE REFERENCES public.appointments(id) ON DELETE RESTRICT,
  slot_range      TSTZRANGE NOT NULL,
  CONSTRAINT appointment_slot_locks_no_overlap
    EXCLUDE USING gist (
      tenant_id WITH =,
      doctor_id WITH =,
      slot_range WITH &&
    )
);

ALTER TABLE public.appointment_slot_locks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS appointment_slot_locks_read ON public.appointment_slot_locks;
CREATE POLICY appointment_slot_locks_read ON public.appointment_slot_locks
  FOR SELECT USING (tenant_id = public.jwt_tenant_id());

REVOKE INSERT, UPDATE, DELETE ON public.appointment_slot_locks FROM authenticated;
GRANT SELECT ON public.appointment_slot_locks TO authenticated;

-- =========================================================================
-- (d) treatment_plan_steps.appointment_id (one-shot link)
-- =========================================================================
ALTER TABLE public.treatment_plan_steps
  ADD COLUMN IF NOT EXISTS appointment_id UUID NULL
    REFERENCES public.appointments(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS treatment_plan_steps_appointment_idx
  ON public.treatment_plan_steps (appointment_id)
  WHERE appointment_id IS NOT NULL;

-- Atualiza column-guard: appointment_id mutavel apenas quando OLD eh NULL.
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
    -- one-shot link permitido; segue
  END IF;

  IF NEW.id             IS DISTINCT FROM OLD.id
     OR NEW.tenant_id      IS DISTINCT FROM OLD.tenant_id
     OR NEW.patient_id     IS DISTINCT FROM OLD.patient_id
     OR NEW.procedure_id   IS DISTINCT FROM OLD.procedure_id
     OR NEW.plan_id        IS DISTINCT FROM OLD.plan_id
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

-- =========================================================================
-- (e) Slot lock triggers — create/release
-- =========================================================================
CREATE OR REPLACE FUNCTION public.create_slot_lock_on_appointment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_duration INTEGER;
  v_range TSTZRANGE;
BEGIN
  v_duration := COALESCE(NEW.duration_minutes, 30);
  v_range := tstzrange(
    NEW.appointment_at,
    NEW.appointment_at + (v_duration * interval '1 minute'),
    '[)'
  );

  BEGIN
    INSERT INTO public.appointment_slot_locks
      (tenant_id, doctor_id, appointment_id, slot_range)
    VALUES (NEW.tenant_id, NEW.doctor_id, NEW.id, v_range);
  EXCEPTION WHEN exclusion_violation THEN
    RAISE EXCEPTION USING
      MESSAGE = format(
        'APPOINTMENT_CONFLICT: doctor=%s slot=%s',
        NEW.doctor_id, v_range
      ),
      ERRCODE = '23P01';
  END;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS appointments_create_slot_lock ON public.appointments;
CREATE TRIGGER appointments_create_slot_lock
  AFTER INSERT ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.create_slot_lock_on_appointment();

CREATE OR REPLACE FUNCTION public.release_slot_lock_on_reversal()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.appointment_slot_locks
   WHERE appointment_id = NEW.appointment_id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS appointment_reversals_release_slot_lock ON public.appointment_reversals;
CREATE TRIGGER appointment_reversals_release_slot_lock
  AFTER INSERT ON public.appointment_reversals
  FOR EACH ROW EXECUTE FUNCTION public.release_slot_lock_on_reversal();

-- =========================================================================
-- (f) Status sync triggers (com guarda anti-loop via pg_trigger_depth)
-- =========================================================================

-- Quando step.status muda → cria completion ou reversal no appointment vinculado.
CREATE OR REPLACE FUNCTION public.step_status_sync_to_appointment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_appointment public.appointments;
BEGIN
  -- Anti-loop: se este trigger foi disparado por outro trigger de sync, sair.
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF NEW.appointment_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_appointment FROM public.appointments WHERE id = NEW.appointment_id;
  IF v_appointment IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'concluido' THEN
    INSERT INTO public.appointment_completions
      (tenant_id, appointment_id, completed_by, source, reason)
    VALUES (
      v_appointment.tenant_id,
      v_appointment.id,
      COALESCE(NEW.completed_by, public.session_uuid('app.actor_id'), v_appointment.tenant_id),
      'plan_step',
      'sync from treatment_plan_steps.id=' || NEW.id::text
    )
    ON CONFLICT (tenant_id, appointment_id) DO NOTHING;
  ELSIF NEW.status = 'cancelado' THEN
    INSERT INTO public.appointment_reversals
      (tenant_id, appointment_id, reversal_amount_cents, reason, created_by)
    VALUES (
      v_appointment.tenant_id,
      v_appointment.id,
      -v_appointment.frozen_amount_cents,
      'sync from treatment_plan_steps.id=' || NEW.id::text,
      COALESCE(public.session_uuid('app.actor_id'), v_appointment.tenant_id)
    )
    ON CONFLICT (tenant_id, appointment_id) DO NOTHING;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS step_status_sync_to_appointment ON public.treatment_plan_steps;
CREATE TRIGGER step_status_sync_to_appointment
  AFTER UPDATE OF status ON public.treatment_plan_steps
  FOR EACH ROW EXECUTE FUNCTION public.step_status_sync_to_appointment();

-- Quando completion entra → marca step como concluido (se houver step linkado).
CREATE OR REPLACE FUNCTION public.appointment_completion_sync_to_step()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  UPDATE public.treatment_plan_steps
     SET status = 'concluido',
         completed_at = NEW.completed_at,
         completed_by = NEW.completed_by
   WHERE appointment_id = NEW.appointment_id
     AND status <> 'concluido';

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS appointment_completion_sync_to_step ON public.appointment_completions;
CREATE TRIGGER appointment_completion_sync_to_step
  AFTER INSERT ON public.appointment_completions
  FOR EACH ROW EXECUTE FUNCTION public.appointment_completion_sync_to_step();

-- Quando reversal entra → marca step como cancelado.
CREATE OR REPLACE FUNCTION public.appointment_reversal_sync_to_step()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  UPDATE public.treatment_plan_steps
     SET status = 'cancelado'
   WHERE appointment_id = NEW.appointment_id
     AND status <> 'cancelado';

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS appointment_reversal_sync_to_step ON public.appointment_reversals;
CREATE TRIGGER appointment_reversal_sync_to_step
  AFTER INSERT ON public.appointment_reversals
  FOR EACH ROW EXECUTE FUNCTION public.appointment_reversal_sync_to_step();

-- =========================================================================
-- (g) Funcoes RPC publicas
-- =========================================================================

-- mark_appointment_realized: registra completion de um atendimento agendado.
CREATE OR REPLACE FUNCTION public.mark_appointment_realized(
  p_appointment_id UUID,
  p_by UUID,
  p_reason TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id UUID;
  v_completion_id UUID;
  v_jwt_tenant UUID;
BEGIN
  v_jwt_tenant := public.jwt_tenant_id();

  SELECT tenant_id INTO v_tenant_id
    FROM public.appointments
   WHERE id = p_appointment_id;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'APPOINTMENT_NOT_FOUND', ERRCODE = '02000';
  END IF;

  -- Multi-tenant: se chamada do client (jwt presente), exige match.
  IF v_jwt_tenant IS NOT NULL AND v_jwt_tenant <> v_tenant_id THEN
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

GRANT EXECUTE ON FUNCTION public.mark_appointment_realized(UUID, UUID, TEXT) TO authenticated;

-- create_step_with_appointment: cria appointment + step linkados em transacao.
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

GRANT EXECUTE ON FUNCTION public.create_step_with_appointment(
  UUID, UUID, UUID, UUID, UUID, TIMESTAMPTZ, INTEGER, TEXT, TEXT, UUID,
  BIGINT, INTEGER, UUID, UUID
) TO authenticated;

-- =========================================================================
-- (h) View appointments_effective recriada com 3-source CASE
--     Substitui a logica derivada-por-tempo da migration 0054.
--     DROP+CREATE porque a forma da view muda (novas colunas completion_id,
--     completed_at, appointment_ends_at) — CREATE OR REPLACE rejeita.
-- =========================================================================
DROP VIEW IF EXISTS public.appointments_effective;
CREATE VIEW public.appointments_effective AS
SELECT
  a.*,
  CASE
    WHEN r.id IS NOT NULL THEN 'estornado'
    WHEN c.id IS NOT NULL THEN 'ativo'
    ELSE                       'agendado'
  END                                                                 AS effective_status,
  (a.frozen_amount_cents + COALESCE(r.reversal_amount_cents, 0))      AS net_amount_cents,
  (
    (a.frozen_amount_cents + COALESCE(r.reversal_amount_cents, 0))
    * a.frozen_commission_bps / 10000
  )                                                                    AS net_commission_cents,
  r.id          AS reversal_id,
  r.created_at  AS reversed_at,
  c.id          AS completion_id,
  c.completed_at,
  (a.appointment_at + COALESCE(a.duration_minutes, 30) * interval '1 minute') AS appointment_ends_at
FROM public.appointments a
LEFT JOIN public.appointment_reversals  r ON r.appointment_id = a.id
LEFT JOIN public.appointment_completions c ON c.appointment_id = a.id;

-- =========================================================================
-- (i) Backfill de appointment_slot_locks para atendimentos existentes ATIVOS.
--     Estornados nao geram lock. Conflitos preexistentes (raros): a primeira
--     linha no BACKFILL ganha o slot; subsequentes que conflitarem sao
--     ignoradas silenciosamente — ficam visiveis pela US4 (highlight visual).
-- =========================================================================
DO $$
DECLARE
  r RECORD;
  v_range tstzrange;
  v_skipped INT := 0;
  v_inserted INT := 0;
BEGIN
  FOR r IN
    SELECT a.id, a.tenant_id, a.doctor_id, a.appointment_at, a.duration_minutes
      FROM public.appointments a
      LEFT JOIN public.appointment_reversals rv ON rv.appointment_id = a.id
      LEFT JOIN public.appointment_slot_locks sl ON sl.appointment_id = a.id
     WHERE rv.id IS NULL
       AND sl.id IS NULL
     ORDER BY a.created_at ASC
  LOOP
    v_range := tstzrange(
      r.appointment_at,
      r.appointment_at + (COALESCE(r.duration_minutes, 30) * interval '1 minute'),
      '[)'
    );
    BEGIN
      INSERT INTO public.appointment_slot_locks
        (tenant_id, doctor_id, appointment_id, slot_range)
      VALUES (r.tenant_id, r.doctor_id, r.id, v_range);
      v_inserted := v_inserted + 1;
    EXCEPTION WHEN exclusion_violation THEN
      v_skipped := v_skipped + 1;
      RAISE NOTICE '[0055 backfill] conflito preexistente; appointment_id=% slot=% — pulado', r.id, v_range;
    END;
  END LOOP;
  RAISE NOTICE '[0055 backfill] slot_locks: % inseridos, % pulados (conflitos preexistentes)', v_inserted, v_skipped;
END $$;

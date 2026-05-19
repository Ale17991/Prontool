-- 0094 — Feature 018: Motor de lembretes automáticos de consulta (Fase 1 — email).
--
-- Conteúdo:
--   1. ALTER tenant_clinic_profile (+8 colunas: enabled, offsets, weekends, window,
--      template subject/body, last_run_at)
--   2. ALTER patients (+1 coluna: reminders_opt_in)
--   3. CREATE TABLE appointment_reminders (append-only, idempotência via UNIQUE partial)
--   4. CHECKs + trigger de validação de array (CHECK com subquery é proibido — SQLSTATE 0A000)
--   5. RLS policies + GRANTs (anon: nada; authenticated: read por jwt_tenant_id; service_role: full)
--   6. Trigger de auditoria via log_audit_event
--   7. Trigger anti-mutation (rejeita UPDATE de status fora do path queued→sent/failed/skipped_*)
--   8. Trigger anti-delete (append-only)
--
-- Constituição:
--   - I (imutabilidade): tabela append-only com trigger anti-delete e anti-update fora do path
--   - II (audit): cada operação gera audit_log via trigger
--   - III (multi-tenant): RLS por tenant_id + UNIQUE composta inclui FK que carrega tenant_id
--   - V (RBAC): write apenas via service_role (cron + manual resend pela rota server-side com requireRole)
--
-- Reversibilidade: aditiva, idempotente. supabase:reset recria.

-- =========================================================================
-- 1. ALTER tenant_clinic_profile — 8 colunas para configuração de lembrete
-- =========================================================================

ALTER TABLE public.tenant_clinic_profile
  ADD COLUMN IF NOT EXISTS reminder_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reminder_offsets_hours INTEGER[] NOT NULL DEFAULT '{24}',
  ADD COLUMN IF NOT EXISTS reminder_send_weekends BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS reminder_window_start TIME NOT NULL DEFAULT '08:00',
  ADD COLUMN IF NOT EXISTS reminder_window_end TIME NOT NULL DEFAULT '20:00',
  ADD COLUMN IF NOT EXISTS reminder_template_subject TEXT NULL,
  ADD COLUMN IF NOT EXISTS reminder_template_body TEXT NULL,
  ADD COLUMN IF NOT EXISTS reminder_last_run_at TIMESTAMPTZ NULL;

-- Validação: array de offsets deve ter 1..5 elementos
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reminder_offsets_valid_length'
  ) THEN
    ALTER TABLE public.tenant_clinic_profile
      ADD CONSTRAINT reminder_offsets_valid_length
      CHECK (array_length(reminder_offsets_hours, 1) BETWEEN 1 AND 5);
  END IF;
END $$;

-- Janela coerente
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reminder_window_valid'
  ) THEN
    ALTER TABLE public.tenant_clinic_profile
      ADD CONSTRAINT reminder_window_valid
      CHECK (reminder_window_end > reminder_window_start);
  END IF;
END $$;

-- Habilitar feature requer ao menos 1 offset (default já é {24}; defesa em profundidade)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reminder_enabled_requires_offsets'
  ) THEN
    ALTER TABLE public.tenant_clinic_profile
      ADD CONSTRAINT reminder_enabled_requires_offsets
      CHECK (NOT reminder_enabled OR array_length(reminder_offsets_hours, 1) >= 1);
  END IF;
END $$;

-- Validação dos VALORES do array (0..168) via trigger.
-- Postgres não permite subquery em CHECK (SQLSTATE 0A000) — mesmo padrão da 0093.
CREATE OR REPLACE FUNCTION public.validate_reminder_offsets()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_min INTEGER;
  v_max INTEGER;
BEGIN
  SELECT MIN(h), MAX(h)
    INTO v_min, v_max
    FROM unnest(NEW.reminder_offsets_hours) AS h;
  IF v_min < 0 OR v_max > 168 THEN
    RAISE EXCEPTION USING
      MESSAGE = 'reminder_offsets_hours must contain only values in [0..168]',
      ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS validate_reminder_offsets ON public.tenant_clinic_profile;
CREATE TRIGGER validate_reminder_offsets
  BEFORE INSERT OR UPDATE OF reminder_offsets_hours ON public.tenant_clinic_profile
  FOR EACH ROW EXECUTE FUNCTION public.validate_reminder_offsets();

-- =========================================================================
-- 2. ALTER patients — opt-in/opt-out de lembretes (LGPD)
-- =========================================================================

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS reminders_opt_in BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.patients.reminders_opt_in IS
  'Feature 018 — TRUE (default): paciente autoriza receber lembretes automáticos. FALSE: opt-out (motor pula com status=skipped_opt_out).';

-- =========================================================================
-- 3. CREATE TABLE appointment_reminders — append-only registry
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.appointment_reminders (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  appointment_id           UUID NOT NULL REFERENCES public.appointments(id) ON DELETE RESTRICT,
  scheduled_offset_hours   INTEGER NOT NULL CHECK (scheduled_offset_hours BETWEEN -1 AND 168),
  channel                  TEXT NOT NULL CHECK (channel IN ('email', 'whatsapp', 'sms')),
  status                   TEXT NOT NULL CHECK (status IN (
    'queued', 'sent', 'failed',
    'skipped_opt_out', 'skipped_reversed', 'skipped_no_email', 'skipped_doctor_inactive'
  )),
  error                    TEXT NULL CHECK (error IS NULL OR length(error) <= 500),
  provider_message_id      TEXT NULL,
  is_manual                BOOLEAN NOT NULL DEFAULT FALSE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at                  TIMESTAMPTZ NULL
);

-- Idempotência: cron (is_manual=FALSE) só pode criar 1 registro por (appointment, offset, channel)
CREATE UNIQUE INDEX IF NOT EXISTS appointment_reminders_idempotency
  ON public.appointment_reminders (appointment_id, scheduled_offset_hours, channel)
  WHERE is_manual = FALSE;

-- Lookup
CREATE INDEX IF NOT EXISTS appointment_reminders_tenant_created_idx
  ON public.appointment_reminders (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS appointment_reminders_tenant_appointment_idx
  ON public.appointment_reminders (tenant_id, appointment_id);
CREATE INDEX IF NOT EXISTS appointment_reminders_queued_idx
  ON public.appointment_reminders (status) WHERE status = 'queued';

-- =========================================================================
-- 4. RLS + GRANTs
-- =========================================================================

ALTER TABLE public.appointment_reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS appointment_reminders_tenant_read ON public.appointment_reminders;
CREATE POLICY appointment_reminders_tenant_read ON public.appointment_reminders
  FOR SELECT TO authenticated
  USING (tenant_id = public.jwt_tenant_id());

GRANT SELECT ON public.appointment_reminders TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.appointment_reminders TO service_role;

-- =========================================================================
-- 5. Trigger de auditoria (Princípio II)
-- =========================================================================

CREATE OR REPLACE FUNCTION public.audit_appointment_reminders_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id,
      'appointment_reminders',
      NEW.id,
      'status',
      NULL,
      NEW.status,
      'channel=' || NEW.channel
        || ';appointment=' || NEW.appointment_id::TEXT
        || ';offset=' || NEW.scheduled_offset_hours::TEXT
        || CASE WHEN NEW.is_manual THEN ';manual=true' ELSE '' END
    );
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id,
      'appointment_reminders',
      NEW.id,
      'status',
      OLD.status,
      NEW.status,
      'transition'
    );
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS audit_appointment_reminders ON public.appointment_reminders;
CREATE TRIGGER audit_appointment_reminders
  AFTER INSERT OR UPDATE ON public.appointment_reminders
  FOR EACH ROW EXECUTE FUNCTION public.audit_appointment_reminders_change();

-- =========================================================================
-- 6. Trigger anti-mutation — só permite queued → sent/failed/skipped_*
-- =========================================================================

CREATE OR REPLACE FUNCTION public.enforce_reminders_status_transition()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Transição autorizada: queued → terminal
  IF OLD.status = 'queued' AND NEW.status IN (
    'sent', 'failed',
    'skipped_opt_out', 'skipped_reversed', 'skipped_no_email', 'skipped_doctor_inactive'
  ) THEN
    RETURN NEW;
  END IF;
  -- Mesmo status (apenas atualizando error ou provider_message_id): ok
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING
    MESSAGE = format(
      'appointment_reminders status transition not allowed: %s → %s',
      OLD.status, NEW.status
    ),
    ERRCODE = '23514';
END $$;

DROP TRIGGER IF EXISTS appointment_reminders_status_transition ON public.appointment_reminders;
CREATE TRIGGER appointment_reminders_status_transition
  BEFORE UPDATE ON public.appointment_reminders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_reminders_status_transition();

-- =========================================================================
-- 7. Trigger anti-delete (append-only)
-- =========================================================================

CREATE OR REPLACE FUNCTION public.appointment_reminders_block_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING
    MESSAGE = 'DELETE not allowed on append-only table appointment_reminders',
    ERRCODE = '42501';
END $$;

DROP TRIGGER IF EXISTS appointment_reminders_no_delete ON public.appointment_reminders;
CREATE TRIGGER appointment_reminders_no_delete
  BEFORE DELETE ON public.appointment_reminders
  FOR EACH STATEMENT EXECUTE FUNCTION public.appointment_reminders_block_delete();

-- =========================================================================
-- 8. Comments
-- =========================================================================

COMMENT ON TABLE public.appointment_reminders IS
  'Feature 018 — append-only. Cada tentativa de envio de lembrete (cron ou manual). UNIQUE composta em (appointment_id, scheduled_offset_hours, channel) WHERE is_manual=FALSE garante idempotência do cron. Reenvios manuais (is_manual=TRUE) NUNCA são bloqueados por UNIQUE.';
COMMENT ON COLUMN public.appointment_reminders.scheduled_offset_hours IS
  'Antecedência configurada (horas). -1 reservado para envio manual fora do ciclo.';
COMMENT ON COLUMN public.appointment_reminders.is_manual IS
  'TRUE quando reenvio manual (admin clicou "Reenviar"). NÃO entra na UNIQUE de idempotência — admin pode reenviar quantas vezes quiser (clarificação Q2).';
COMMENT ON COLUMN public.tenant_clinic_profile.reminder_enabled IS
  'Feature 018 — toggle global do motor de lembretes por tenant. Default FALSE.';
COMMENT ON COLUMN public.tenant_clinic_profile.reminder_offsets_hours IS
  'Feature 018 — lista de antecedências em horas (default {24}). Múltiplos valores geram múltiplos lembretes por agendamento (ex.: {48, 2}).';

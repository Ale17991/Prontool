-- 0083 — Bloqueios de agenda (atividades nao-atendimento) + relaxa
-- duration_minutes para aceitar 'dia inteiro' (1440 min).
--
-- ## Tabela schedule_blocks
--
-- Registra bloqueios manuais na agenda de um profissional: reuniao,
-- curso, ferias, manutencao, pessoal etc. Renderizado no calendar como
-- faixa cinza com cadeado. NAO afeta appointment_slot_locks — bloqueios
-- sao indicativos, nao hard-block. A constraint real de conflito
-- continua sendo EXCLUDE em appointment_slot_locks (atendimentos).
--
-- Soft delete via deleted_at: cancelar = update deleted_at. Linhas com
-- deleted_at IS NOT NULL nao aparecem no calendar.
--
-- ## Relax duration_minutes
--
-- A migration 0053 limitou duration entre 5 e 480 min (8h). Atendimento
-- 'dia inteiro' precisa de 1440 min. Substituimos o CHECK por BETWEEN
-- 5 AND 1440.

-- ==========================================================================
-- (a) Tabela schedule_blocks
-- ==========================================================================

CREATE TABLE IF NOT EXISTS public.schedule_blocks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  doctor_id   UUID NOT NULL REFERENCES public.doctors(id) ON DELETE RESTRICT,
  block_date  DATE NOT NULL,
  start_time  TIME,
  end_time    TIME,
  all_day     BOOLEAN NOT NULL DEFAULT FALSE,
  reason      TEXT NOT NULL CHECK (char_length(trim(reason)) >= 2),
  created_by  UUID NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ,
  deleted_by  UUID,
  CONSTRAINT schedule_blocks_all_day_consistency CHECK (
    (all_day = TRUE  AND start_time IS NULL     AND end_time IS NULL)
    OR
    (all_day = FALSE AND start_time IS NOT NULL AND end_time IS NOT NULL
                     AND end_time > start_time)
  )
);

CREATE INDEX IF NOT EXISTS schedule_blocks_tenant_date_idx
  ON public.schedule_blocks (tenant_id, block_date)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS schedule_blocks_doctor_date_idx
  ON public.schedule_blocks (tenant_id, doctor_id, block_date)
  WHERE deleted_at IS NULL;

-- ==========================================================================
-- (b) RLS — leitura por tenant; INSERT/UPDATE controlado por RBAC server-side
-- ==========================================================================

ALTER TABLE public.schedule_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS schedule_blocks_read ON public.schedule_blocks;
CREATE POLICY schedule_blocks_read ON public.schedule_blocks
  FOR SELECT USING (tenant_id = public.jwt_tenant_id());

-- Escrita via service_role (handlers fazem requireRole + validacao de
-- doctor_id para profissional_saude).
REVOKE INSERT, UPDATE, DELETE ON public.schedule_blocks FROM authenticated;
GRANT SELECT ON public.schedule_blocks TO authenticated;

-- ==========================================================================
-- (c) Imutabilidade parcial (so deleted_at/deleted_by mutaveis)
-- ==========================================================================

CREATE OR REPLACE FUNCTION public.enforce_schedule_block_mutability()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role', 'supabase_auth_admin') THEN
    -- service_role bypassa para suportar soft delete via handlers
    RETURN NEW;
  END IF;

  -- Soft delete (deleted_at: NULL -> timestamp) e' o unico UPDATE permitido.
  IF NEW.id            IS DISTINCT FROM OLD.id
     OR NEW.tenant_id  IS DISTINCT FROM OLD.tenant_id
     OR NEW.doctor_id  IS DISTINCT FROM OLD.doctor_id
     OR NEW.block_date IS DISTINCT FROM OLD.block_date
     OR NEW.start_time IS DISTINCT FROM OLD.start_time
     OR NEW.end_time   IS DISTINCT FROM OLD.end_time
     OR NEW.all_day    IS DISTINCT FROM OLD.all_day
     OR NEW.reason     IS DISTINCT FROM OLD.reason
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING
      MESSAGE = 'schedule_blocks: only deleted_at/deleted_by are mutable',
      ERRCODE = '42501';
  END IF;

  -- deleted_at: nao pode voltar pra NULL apos ja' setado (append-only).
  IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'schedule_blocks: deleted_at cannot be un-set',
      ERRCODE = '42501';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS enforce_schedule_block_mutability ON public.schedule_blocks;
CREATE TRIGGER enforce_schedule_block_mutability
BEFORE UPDATE ON public.schedule_blocks
FOR EACH ROW EXECUTE FUNCTION public.enforce_schedule_block_mutability();

-- DELETE bloqueado para qualquer role (use soft delete).
CREATE OR REPLACE FUNCTION public.enforce_schedule_block_no_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING
    MESSAGE = 'schedule_blocks: use soft delete (deleted_at) instead of DELETE',
    ERRCODE = '42501';
END $$;

DROP TRIGGER IF EXISTS enforce_schedule_block_no_delete ON public.schedule_blocks;
CREATE TRIGGER enforce_schedule_block_no_delete
BEFORE DELETE ON public.schedule_blocks
FOR EACH ROW EXECUTE FUNCTION public.enforce_schedule_block_no_delete();

-- ==========================================================================
-- (d) Audit trail
-- ==========================================================================

CREATE OR REPLACE FUNCTION public.audit_schedule_block_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id,
      'schedule_blocks',
      NEW.id,
      'created',
      NULL,
      NEW.reason,
      'doctor=' || NEW.doctor_id::text
        || ';date=' || NEW.block_date::text
        || ';all_day=' || NEW.all_day::text
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id,
      'schedule_blocks',
      NEW.id,
      'cancelled',
      NEW.reason,
      NULL,
      'cancelled_by=' || COALESCE(NEW.deleted_by::text, 'unknown')
    );
    RETURN NEW;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS audit_schedule_block_change ON public.schedule_blocks;
CREATE TRIGGER audit_schedule_block_change
AFTER INSERT OR UPDATE ON public.schedule_blocks
FOR EACH ROW EXECUTE FUNCTION public.audit_schedule_block_change();

-- ==========================================================================
-- (e) Relax duration_minutes para aceitar dia inteiro (1440 min)
-- ==========================================================================

ALTER TABLE public.appointments
  DROP CONSTRAINT IF EXISTS appointments_duration_minutes_check;

ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_duration_minutes_check
  CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 5 AND 1440);

NOTIFY pgrst, 'reload schema';

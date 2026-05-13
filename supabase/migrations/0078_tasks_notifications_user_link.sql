-- Migration 0078 — Tarefas operacionais + Notificações persistidas + vínculo user↔doctor.
-- Spec: specs/012-tarefas-notificacoes-usuarios/spec.md
-- Plan: specs/012-tarefas-notificacoes-usuarios/plan.md
-- Data model: specs/012-tarefas-notificacoes-usuarios/data-model.md
--
-- Três deltas neste arquivo:
--   1. Nova tabela public.tasks (tarefas operacionais por tenant + responsável)
--      + triggers de imutabilidade parcial, audit, RLS, GRANTs.
--   2. Nova tabela public.notifications (persistidas por usuário) com UNIQUE
--      natural key para idempotência + RLS user_id = auth.uid().
--   3. ALTER public.doctors + user_id UUID NULL + UNIQUE parcial (tenant_id, user_id)
--      + trigger de audit em mudança de vínculo.
--   4. RPC generate_user_notifications(tenant_id, user_id) SECURITY DEFINER
--      gera 4 categorias lazy via UPSERT idempotente.
--
-- Append-only (Constitution I): triggers bloqueiam mudança de colunas core
-- em tasks; notifications só is_read/read_at mutáveis. Audit (Constitution II)
-- via log_audit_event. RLS por tenant_id + visibility (Constitution III).
-- RBAC server-side (Constitution V): RLS aplica filtros; service layer reforça.

-- ============================================================================
-- 1) public.tasks — tarefas operacionais
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.tasks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  title         TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  notes         TEXT CHECK (notes IS NULL OR char_length(notes) <= 1000),
  due_date      DATE NOT NULL,
  assigned_to   UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  assigned_by   UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  priority      TEXT NOT NULL CHECK (priority IN ('baixa', 'normal', 'alta', 'urgente')),
  status        TEXT NOT NULL DEFAULT 'pendente'
                  CHECK (status IN ('pendente', 'concluida')),
  completed_at  TIMESTAMPTZ,
  completed_by  UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  deleted_at    TIMESTAMPTZ,
  deleted_by    UUID REFERENCES auth.users(id) ON DELETE RESTRICT,

  CONSTRAINT tasks_completion_check CHECK (
    (status = 'concluida' AND completed_at IS NOT NULL AND completed_by IS NOT NULL)
    OR
    (status = 'pendente' AND completed_at IS NULL AND completed_by IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS tasks_tenant_status_idx
  ON public.tasks (tenant_id, status, due_date)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS tasks_assigned_to_idx
  ON public.tasks (tenant_id, assigned_to, due_date)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS tasks_overdue_idx
  ON public.tasks (tenant_id, assigned_to, due_date)
  WHERE deleted_at IS NULL AND status = 'pendente';

-- Imutabilidade parcial
CREATE OR REPLACE FUNCTION public.enforce_tasks_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role') THEN
    RETURN NEW;
  END IF;
  IF NEW.id          IS DISTINCT FROM OLD.id
     OR NEW.tenant_id   IS DISTINCT FROM OLD.tenant_id
     OR NEW.title       IS DISTINCT FROM OLD.title
     OR NEW.due_date    IS DISTINCT FROM OLD.due_date
     OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
     OR NEW.assigned_by IS DISTINCT FROM OLD.assigned_by
     OR NEW.created_at  IS DISTINCT FROM OLD.created_at
     OR NEW.created_by  IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'tasks: id, tenant_id, title, due_date, assigned_to, assigned_by, created_at, created_by são imutáveis (audit history integrity)';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tasks_immutable_columns ON public.tasks;
CREATE TRIGGER tasks_immutable_columns
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.enforce_tasks_mutation();

DROP TRIGGER IF EXISTS tasks_no_physical_delete ON public.tasks;
CREATE TRIGGER tasks_no_physical_delete
  BEFORE DELETE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only();

-- Audit
CREATE OR REPLACE FUNCTION public.audit_tasks_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'tasks', NEW.id, 'created',
      NULL,
      format('%s|prioridade=%s|prazo=%s|para=%s', NEW.title, NEW.priority, NEW.due_date::text, NEW.assigned_to::text),
      'task-created'
    );
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'tasks', NEW.id,
      'status', OLD.status, NEW.status,
      CASE WHEN NEW.status = 'concluida' THEN 'task-completed' ELSE 'task-reopened' END
    );
  END IF;
  IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at AND NEW.deleted_at IS NOT NULL THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'tasks', NEW.id,
      'deleted_at', NULL, NEW.deleted_at::text, 'task-soft-deleted'
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tasks_audit ON public.tasks;
CREATE TRIGGER tasks_audit
  AFTER INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.audit_tasks_change();

-- RLS + grants
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tasks_read ON public.tasks;
CREATE POLICY tasks_read ON public.tasks FOR SELECT
  USING (
    tenant_id = public.jwt_tenant_id()
    AND (public.jwt_role() = 'admin' OR assigned_to = auth.uid())
  );

DROP POLICY IF EXISTS tasks_insert ON public.tasks;
CREATE POLICY tasks_insert ON public.tasks FOR INSERT
  WITH CHECK (
    tenant_id = public.jwt_tenant_id()
    AND (public.jwt_role() = 'admin' OR assigned_to = auth.uid())
  );

DROP POLICY IF EXISTS tasks_update ON public.tasks;
CREATE POLICY tasks_update ON public.tasks FOR UPDATE
  USING (
    tenant_id = public.jwt_tenant_id()
    AND (public.jwt_role() = 'admin' OR assigned_to = auth.uid())
  )
  WITH CHECK (
    tenant_id = public.jwt_tenant_id()
    AND (public.jwt_role() = 'admin' OR assigned_to = auth.uid())
  );

REVOKE UPDATE, DELETE ON public.tasks FROM authenticated;
GRANT SELECT, INSERT ON public.tasks TO authenticated;
GRANT UPDATE (status, completed_at, completed_by, notes, priority, deleted_at, deleted_by)
  ON public.tasks TO authenticated;

-- ============================================================================
-- 2) public.notifications — notificações persistidas por usuário
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN (
                    'atendimento', 'tarefa', 'tarefa_atrasada', 'aniversarios_mes'
                  )),
  title           TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  body            TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  reference_id    UUID NULL,
  reference_type  TEXT NULL CHECK (
                    reference_type IS NULL OR reference_type IN ('appointment', 'task', 'month')
                  ),
  reference_key   TEXT NOT NULL CHECK (char_length(reference_key) BETWEEN 1 AND 100),
  is_read         BOOLEAN NOT NULL DEFAULT FALSE,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT notifications_read_check CHECK (
    (is_read = TRUE AND read_at IS NOT NULL)
    OR
    (is_read = FALSE AND read_at IS NULL)
  )
);

-- Idempotência: previne duplicatas (UNIQUE natural key)
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedup_unique
  ON public.notifications (tenant_id, user_id, type, reference_key);

CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON public.notifications (tenant_id, user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_unread_idx
  ON public.notifications (tenant_id, user_id)
  WHERE is_read = FALSE;

-- Imutabilidade exceto is_read/read_at
CREATE OR REPLACE FUNCTION public.enforce_notifications_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role') THEN
    RETURN NEW;
  END IF;
  IF NEW.id              IS DISTINCT FROM OLD.id
     OR NEW.tenant_id       IS DISTINCT FROM OLD.tenant_id
     OR NEW.user_id         IS DISTINCT FROM OLD.user_id
     OR NEW.type            IS DISTINCT FROM OLD.type
     OR NEW.title           IS DISTINCT FROM OLD.title
     OR NEW.body            IS DISTINCT FROM OLD.body
     OR NEW.reference_id    IS DISTINCT FROM OLD.reference_id
     OR NEW.reference_type  IS DISTINCT FROM OLD.reference_type
     OR NEW.reference_key   IS DISTINCT FROM OLD.reference_key
     OR NEW.created_at      IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'notifications: apenas is_read/read_at mutáveis';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS notifications_immutable_columns ON public.notifications;
CREATE TRIGGER notifications_immutable_columns
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.enforce_notifications_mutation();

DROP TRIGGER IF EXISTS notifications_no_physical_delete ON public.notifications;
CREATE TRIGGER notifications_no_physical_delete
  BEFORE DELETE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only();

-- RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_user_only ON public.notifications;
CREATE POLICY notifications_user_only ON public.notifications FOR SELECT
  USING (tenant_id = public.jwt_tenant_id() AND user_id = auth.uid());

DROP POLICY IF EXISTS notifications_user_update ON public.notifications;
CREATE POLICY notifications_user_update ON public.notifications FOR UPDATE
  USING (tenant_id = public.jwt_tenant_id() AND user_id = auth.uid())
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND user_id = auth.uid());

REVOKE INSERT, UPDATE, DELETE ON public.notifications FROM authenticated;
GRANT SELECT ON public.notifications TO authenticated;
GRANT UPDATE (is_read, read_at) ON public.notifications TO authenticated;
-- INSERT é feito apenas via RPC SECURITY DEFINER `generate_user_notifications`.

-- ============================================================================
-- 3) ALTER public.doctors — coluna user_id + unique + audit
-- ============================================================================
ALTER TABLE public.doctors
  ADD COLUMN IF NOT EXISTS user_id UUID NULL
    REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS doctors_user_id_unique_idx
  ON public.doctors (tenant_id, user_id)
  WHERE user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.audit_user_doctor_link()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'doctors', NEW.id,
      'user_id', OLD.user_id::text, NEW.user_id::text,
      CASE
        WHEN NEW.user_id IS NULL THEN 'doctor-user-unlinked'
        WHEN OLD.user_id IS NULL THEN 'doctor-user-linked'
        ELSE 'doctor-user-relinked'
      END
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS doctors_user_link_audit ON public.doctors;
CREATE TRIGGER doctors_user_link_audit
  AFTER UPDATE OF user_id ON public.doctors
  FOR EACH ROW EXECUTE FUNCTION public.audit_user_doctor_link();

-- Permitir UPDATE da coluna user_id pelo serviço (service role) e
-- pelo admin via app. UPDATE policy do doctors já existe (admin only).
-- Adiciona grant explícito da coluna user_id para authenticated (admin via RLS).
GRANT UPDATE (user_id) ON public.doctors TO authenticated;

-- ============================================================================
-- 4) RPC generate_user_notifications — geração lazy idempotente
-- ============================================================================
CREATE OR REPLACE FUNCTION public.generate_user_notifications(
  p_tenant_id    UUID,
  p_user_id      UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today              DATE := CURRENT_DATE;
  v_role               TEXT;
  v_doctor_id          UUID;
  v_inserted_atend     INT := 0;
  v_inserted_tarefa    INT := 0;
  v_inserted_atrasada  INT := 0;
  v_inserted_aniver    INT := 0;
  v_encryption_key     TEXT;
BEGIN
  -- 1. Valida que o user_id pertence ao tenant_id.
  IF NOT EXISTS (
    SELECT 1 FROM public.user_tenants
    WHERE user_id = p_user_id AND tenant_id = p_tenant_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'USER_NOT_IN_TENANT' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO v_role FROM public.user_tenants
    WHERE user_id = p_user_id AND tenant_id = p_tenant_id;

  -- 2. Vínculo a doctor (se houver) — define escopo de atendimentos.
  SELECT id INTO v_doctor_id FROM public.doctors
    WHERE tenant_id = p_tenant_id AND user_id = p_user_id LIMIT 1;

  -- 3. ATENDIMENTOS DE HOJE
  --    Admin: todos do tenant. Doctor vinculado: só os dele.
  --    Demais: nenhum.
  WITH today_apts AS (
    SELECT
      a.id,
      a.appointment_at,
      d.full_name AS doctor_name,
      p.tuss_code,
      p.display_name AS procedure_name
    FROM public.appointments_effective a
    JOIN public.doctors d ON d.id = a.doctor_id
    JOIN public.procedures p ON p.id = a.procedure_id
    WHERE a.tenant_id = p_tenant_id
      AND DATE(a.appointment_at AT TIME ZONE 'UTC') = v_today
      AND COALESCE(a.effective_status, 'agendado') IN ('agendado', 'ativo')
      AND (
        v_role = 'admin'
        OR (v_doctor_id IS NOT NULL AND a.doctor_id = v_doctor_id)
      )
  )
  INSERT INTO public.notifications (
    tenant_id, user_id, type, title, body,
    reference_id, reference_type, reference_key
  )
  SELECT
    p_tenant_id, p_user_id, 'atendimento',
    'Atendimento hoje',
    format('Atendimento às %s — %s (procedimento: %s)',
      to_char(t.appointment_at AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI'),
      t.doctor_name,
      COALESCE(t.procedure_name, t.tuss_code, '—')
    ),
    t.id, 'appointment', t.id::text
  FROM today_apts t
  ON CONFLICT (tenant_id, user_id, type, reference_key) DO NOTHING;
  GET DIAGNOSTICS v_inserted_atend = ROW_COUNT;

  -- 4. TAREFAS COM PRAZO HOJE (status pendente)
  INSERT INTO public.notifications (
    tenant_id, user_id, type, title, body,
    reference_id, reference_type, reference_key
  )
  SELECT
    p_tenant_id, p_user_id, 'tarefa',
    'Tarefa para hoje',
    format($f$Lembrete: '%s' precisa ser concluída hoje$f$, t.title),
    t.id, 'task', t.id::text || ':' || t.due_date::text
  FROM public.tasks t
  WHERE t.tenant_id = p_tenant_id
    AND t.assigned_to = p_user_id
    AND t.status = 'pendente'
    AND t.deleted_at IS NULL
    AND t.due_date = v_today
  ON CONFLICT (tenant_id, user_id, type, reference_key) DO NOTHING;
  GET DIAGNOSTICS v_inserted_tarefa = ROW_COUNT;

  -- 5. TAREFAS ATRASADAS (due_date < hoje, ainda pendente)
  INSERT INTO public.notifications (
    tenant_id, user_id, type, title, body,
    reference_id, reference_type, reference_key
  )
  SELECT
    p_tenant_id, p_user_id, 'tarefa_atrasada',
    'Tarefa atrasada',
    format($f$Atenção: '%s' está pendente desde %s$f$, t.title, to_char(t.due_date, 'DD/MM/YYYY')),
    t.id, 'task', t.id::text
  FROM public.tasks t
  WHERE t.tenant_id = p_tenant_id
    AND t.assigned_to = p_user_id
    AND t.status = 'pendente'
    AND t.deleted_at IS NULL
    AND t.due_date < v_today
  ON CONFLICT (tenant_id, user_id, type, reference_key) DO NOTHING;
  GET DIAGNOSTICS v_inserted_atrasada = ROW_COUNT;

  -- 6. ANIVERSARIANTES DO MÊS — só se houver pelo menos 1
  --    Caller deve setar app.encryption_key antes desta RPC.
  --    Sem chave: pula sem erro (não bloqueia outras categorias).
  BEGIN
    v_encryption_key := current_setting('app.encryption_key', TRUE);
  EXCEPTION WHEN OTHERS THEN
    v_encryption_key := NULL;
  END;

  IF v_encryption_key IS NOT NULL AND v_encryption_key <> '' THEN
    WITH birthdays AS (
      SELECT
        p.id,
        extensions.pgp_sym_decrypt(p.full_name_enc, v_encryption_key) AS full_name,
        extract(day FROM extensions.pgp_sym_decrypt(p.birth_date_enc, v_encryption_key)::date)::int AS dia
      FROM public.patients p
      WHERE p.tenant_id = p_tenant_id
        AND p.birth_date_enc IS NOT NULL
        AND p.deleted_at IS NULL
        AND p.anonymized_at IS NULL
        AND extract(month FROM extensions.pgp_sym_decrypt(p.birth_date_enc, v_encryption_key)::date)::int
            = extract(month FROM CURRENT_DATE)::int
    ),
    aggregated AS (
      SELECT
        string_agg(full_name || ' (dia ' || dia::text || ')', ', ' ORDER BY dia, full_name) AS list,
        count(*) AS n
      FROM birthdays
    )
    INSERT INTO public.notifications (
      tenant_id, user_id, type, title, body,
      reference_id, reference_type, reference_key
    )
    SELECT
      p_tenant_id, p_user_id, 'aniversarios_mes',
      'Aniversariantes deste mês',
      format(
        $f$Aniversariantes de %s: %s. Uma ótima oportunidade para fortalecer o vínculo com seus pacientes!$f$,
        to_char(CURRENT_DATE, 'TMMonth'),
        list
      ),
      NULL, 'month', to_char(CURRENT_DATE, 'YYYY-MM')
    FROM aggregated
    WHERE n > 0
    ON CONFLICT (tenant_id, user_id, type, reference_key) DO NOTHING;
    GET DIAGNOSTICS v_inserted_aniver = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'inserted_atendimento',     v_inserted_atend,
    'inserted_tarefa',          v_inserted_tarefa,
    'inserted_tarefa_atrasada', v_inserted_atrasada,
    'inserted_aniversarios',    v_inserted_aniver
  );
END $$;

GRANT EXECUTE ON FUNCTION public.generate_user_notifications(UUID, UUID) TO authenticated;

-- ============================================================================
-- PostgREST schema reload
-- ============================================================================
NOTIFY pgrst, 'reload schema';

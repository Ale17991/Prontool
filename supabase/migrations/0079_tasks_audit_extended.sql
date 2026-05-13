-- Migration 0079 — Estende audit_tasks_change para logar mudancas em
-- title, notes, due_date, assigned_to e priority (alem do que ja loga:
-- created, status, deleted_at).
--
-- Contexto: a feature 012 entregou tarefas com apenas status/notes/
-- priority mutaveis. Agora admin pode editar title/due_date/assigned_to
-- via API route (service_role bypassa o trigger de imutabilidade).
-- Constitution II exige audit de cada mudanca relevante.
--
-- Idempotente: CREATE OR REPLACE da funcao. Trigger continua o mesmo.

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

  -- status (concluir / reabrir)
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'tasks', NEW.id,
      'status', OLD.status, NEW.status,
      CASE WHEN NEW.status = 'concluida' THEN 'task-completed' ELSE 'task-reopened' END
    );
  END IF;

  -- title (admin edit)
  IF NEW.title IS DISTINCT FROM OLD.title THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'tasks', NEW.id,
      'title', OLD.title, NEW.title, 'task-title-edited'
    );
  END IF;

  -- due_date (admin edit)
  IF NEW.due_date IS DISTINCT FROM OLD.due_date THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'tasks', NEW.id,
      'due_date', OLD.due_date::text, NEW.due_date::text, 'task-due-date-edited'
    );
  END IF;

  -- assigned_to (admin edit)
  IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'tasks', NEW.id,
      'assigned_to', OLD.assigned_to::text, NEW.assigned_to::text, 'task-reassigned'
    );
  END IF;

  -- priority (admin edit)
  IF NEW.priority IS DISTINCT FROM OLD.priority THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'tasks', NEW.id,
      'priority', OLD.priority, NEW.priority, 'task-priority-edited'
    );
  END IF;

  -- notes (qualquer edit)
  IF NEW.notes IS DISTINCT FROM OLD.notes THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'tasks', NEW.id,
      'notes',
      CASE WHEN OLD.notes IS NULL THEN NULL ELSE substring(OLD.notes, 1, 200) END,
      CASE WHEN NEW.notes IS NULL THEN NULL ELSE substring(NEW.notes, 1, 200) END,
      'task-notes-edited'
    );
  END IF;

  -- soft-delete
  IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at AND NEW.deleted_at IS NOT NULL THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'tasks', NEW.id,
      'deleted_at', NULL, NEW.deleted_at::text, 'task-soft-deleted'
    );
  END IF;

  RETURN NEW;
END $$;

NOTIFY pgrst, 'reload schema';

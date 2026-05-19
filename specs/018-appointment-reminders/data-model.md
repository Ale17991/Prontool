# Data Model: Motor de lembretes automáticos de consulta

**Feature**: 018-appointment-reminders
**Migration**: `supabase/migrations/0094_appointment_reminders.sql`

## Overview

Adiciona configuração de lembretes por clínica em `tenant_clinic_profile`, flag opt-in por paciente em `patients`, e tabela append-only `appointment_reminders` para registrar cada tentativa de envio. Reusa `log_audit_event` existente para audit log (Princípio II).

## Entities

### 1. `appointment_reminders` (NEW)

Registro append-only de cada tentativa de envio.

| Coluna | Tipo | Constraint | Descrição |
|--------|------|------------|-----------|
| `id` | `UUID` | PK, default `gen_random_uuid()` | Identificador único |
| `tenant_id` | `UUID` | NOT NULL, FK `tenants(id) ON DELETE RESTRICT` | Tenant proprietário |
| `appointment_id` | `UUID` | NOT NULL, FK `appointments(id) ON DELETE RESTRICT` | Agendamento referenciado |
| `scheduled_offset_hours` | `INTEGER` | NOT NULL, CHECK `BETWEEN -1 AND 168` | Antecedência configurada (h); `-1` = envio manual fora do ciclo |
| `channel` | `TEXT` | NOT NULL, CHECK `IN ('email', 'whatsapp', 'sms')` | Canal — Fase 1 só `email`; outros reservados |
| `status` | `TEXT` | NOT NULL, CHECK `IN ('queued', 'sent', 'failed', 'skipped_opt_out', 'skipped_reversed', 'skipped_no_email', 'skipped_doctor_inactive')` | Estado final do envio |
| `error` | `TEXT` | NULL | Motivo legível de falha (truncado a 500 chars) |
| `provider_message_id` | `TEXT` | NULL | ID retornado pelo provedor de email (rastreabilidade) |
| `is_manual` | `BOOLEAN` | NOT NULL, default `FALSE` | `TRUE` quando reenvio manual (US3); `FALSE` quando ciclo automático |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, default `now()` | Quando o registro foi criado |
| `sent_at` | `TIMESTAMPTZ` | NULL | Quando o envio efetivamente saiu (`status='sent'`) |

#### Constraints adicionais

- **Idempotência (CRÍTICA)**: `UNIQUE (appointment_id, scheduled_offset_hours, channel) WHERE is_manual = FALSE` — partial unique index. Manual resends NÃO entram na unicidade (admin pode reenviar quantas vezes quiser).
- Status transitions allowed (enforced by trigger): `queued → sent`, `queued → failed`, `queued → skipped_*`. Nenhum outro UPDATE de status é permitido. **NUNCA DELETE** (trigger anti-delete).

#### Indexes

```sql
CREATE INDEX ON appointment_reminders (tenant_id, created_at DESC);  -- listagem histórico
CREATE INDEX ON appointment_reminders (tenant_id, appointment_id);   -- lookup por agendamento
CREATE INDEX ON appointment_reminders (status) WHERE status = 'queued';  -- recovery (poucos rows típicos)
CREATE UNIQUE INDEX appointment_reminders_idempotency
  ON appointment_reminders (appointment_id, scheduled_offset_hours, channel)
  WHERE is_manual = FALSE;
```

#### RLS

```sql
ALTER TABLE appointment_reminders ENABLE ROW LEVEL SECURITY;

-- Authenticated: leitura por tenant
CREATE POLICY appointment_reminders_tenant_read ON appointment_reminders
  FOR SELECT TO authenticated
  USING (tenant_id = public.jwt_tenant_id());

-- Sem policy de INSERT/UPDATE/DELETE para authenticated — só service-role (cron + manual resend via server-side com requireRole)
GRANT SELECT ON appointment_reminders TO authenticated;
GRANT SELECT, INSERT, UPDATE ON appointment_reminders TO service_role;
```

#### Triggers

```sql
-- Trigger 1: audit log
CREATE TRIGGER audit_appointment_reminders_change
  AFTER INSERT OR UPDATE ON appointment_reminders
  FOR EACH ROW EXECUTE FUNCTION audit_appointment_reminders_change();

-- Trigger 2: anti-mutation (rejeita UPDATE fora do path queued→sent/failed/skipped_*)
CREATE TRIGGER appointment_reminders_immutable_status
  BEFORE UPDATE ON appointment_reminders
  FOR EACH ROW EXECUTE FUNCTION enforce_reminders_status_transition();

-- Trigger 3: anti-delete (Princípio I conceitual — append-only)
CREATE TRIGGER appointment_reminders_no_delete
  BEFORE DELETE ON appointment_reminders
  FOR EACH STATEMENT EXECUTE FUNCTION raise_no_delete_allowed();
```

#### State diagram

```text
                  ┌────────┐
       INSERT ────│ queued │────────┐
                  └────┬───┘        │
                       │            │
            ┌──────────┴──────────┐ │
            │                     │ │
            ▼                     ▼ ▼
        ┌──────┐              ┌────────┐
        │ sent │              │ failed │
        └──────┘              └────────┘
            │                     │
            │                     │
            ▼                     ▼
        terminal              terminal (admin pode acionar resend manual,
                              que cria registro NOVO com is_manual=TRUE)

  Alternatively from queued:
                  ┌──────────────────────────────┐
                  │ skipped_opt_out              │
                  │ skipped_reversed             │ (todos terminais)
                  │ skipped_no_email             │
                  │ skipped_doctor_inactive      │
                  └──────────────────────────────┘
```

### 2. `tenant_clinic_profile` (ALTER — +7 colunas)

Configuração de lembretes da clínica.

| Coluna | Tipo | Default | Descrição |
|--------|------|---------|-----------|
| `reminder_enabled` | `BOOLEAN` | `FALSE` | Toggle global da feature por tenant |
| `reminder_offsets_hours` | `INTEGER[]` | `'{24}'` | Lista de antecedências em horas |
| `reminder_send_weekends` | `BOOLEAN` | `TRUE` | Permitir envio sáb/dom |
| `reminder_window_start` | `TIME` | `'08:00'` | Hora local (TZ tenant) início janela permitida |
| `reminder_window_end` | `TIME` | `'20:00'` | Hora local fim janela |
| `reminder_template_subject` | `TEXT` | `NULL` | Custom subject; `NULL` = usa default |
| `reminder_template_body` | `TEXT` | `NULL` | Custom body HTML; `NULL` = usa default |
| `reminder_last_run_at` | `TIMESTAMPTZ` | `NULL` | Última execução do cron para este tenant |

#### Constraints

```sql
ALTER TABLE tenant_clinic_profile
  ADD CONSTRAINT reminder_offsets_valid CHECK (
    array_length(reminder_offsets_hours, 1) BETWEEN 1 AND 5
  );

-- Validação dos valores 0..168 do array via trigger (Postgres não permite subquery em CHECK — mesmo padrão da migration 0093)
CREATE TRIGGER tenant_clinic_profile_validate_reminder_offsets
  BEFORE INSERT OR UPDATE OF reminder_offsets_hours ON tenant_clinic_profile
  FOR EACH ROW EXECUTE FUNCTION validate_reminder_offsets();

ALTER TABLE tenant_clinic_profile
  ADD CONSTRAINT reminder_window_valid CHECK (reminder_window_end > reminder_window_start);

-- Habilitar feature requer pelo menos 1 offset (já é default ARRAY[24], mas defesa em profundidade)
ALTER TABLE tenant_clinic_profile
  ADD CONSTRAINT reminder_enabled_requires_offsets CHECK (
    NOT reminder_enabled OR array_length(reminder_offsets_hours, 1) >= 1
  );
```

### 3. `patients` (ALTER — +1 coluna)

Opt-in/opt-out do paciente.

| Coluna | Tipo | Default | Descrição |
|--------|------|---------|-----------|
| `reminders_opt_in` | `BOOLEAN` | `TRUE` | `FALSE` = paciente pediu para não receber lembretes automáticos |

Sem novo índice (filtragem por `tenant_id` + `reminders_opt_in = TRUE` cobre via index existente em `tenant_id`; opt-in é raro o suficiente para não justificar índice dedicado).

#### Audit

INSERT/UPDATE da flag já é auditado pelo trigger existente em `patients` (feature 001/002).

## Relationships

```text
tenants 1 ──── N appointment_reminders
  │
  └── 1 ──── 1 tenant_clinic_profile (com configuração de lembrete)

appointments 1 ──── N appointment_reminders
patients 1 ──── N appointments (existente)
patients reminders_opt_in (atributo, sem nova relação)
```

## Migration sketch

```sql
-- 0094_appointment_reminders.sql

-- 1. ALTER tenant_clinic_profile
ALTER TABLE public.tenant_clinic_profile
  ADD COLUMN IF NOT EXISTS reminder_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reminder_offsets_hours INTEGER[] NOT NULL DEFAULT '{24}',
  ADD COLUMN IF NOT EXISTS reminder_send_weekends BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS reminder_window_start TIME NOT NULL DEFAULT '08:00',
  ADD COLUMN IF NOT EXISTS reminder_window_end TIME NOT NULL DEFAULT '20:00',
  ADD COLUMN IF NOT EXISTS reminder_template_subject TEXT NULL,
  ADD COLUMN IF NOT EXISTS reminder_template_body TEXT NULL,
  ADD COLUMN IF NOT EXISTS reminder_last_run_at TIMESTAMPTZ NULL;

-- 2. CHECKs em tenant_clinic_profile (já listadas acima)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reminder_offsets_valid_length') THEN
    ALTER TABLE public.tenant_clinic_profile
      ADD CONSTRAINT reminder_offsets_valid_length
      CHECK (array_length(reminder_offsets_hours, 1) BETWEEN 1 AND 5);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reminder_window_valid') THEN
    ALTER TABLE public.tenant_clinic_profile
      ADD CONSTRAINT reminder_window_valid
      CHECK (reminder_window_end > reminder_window_start);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reminder_enabled_requires_offsets') THEN
    ALTER TABLE public.tenant_clinic_profile
      ADD CONSTRAINT reminder_enabled_requires_offsets
      CHECK (NOT reminder_enabled OR array_length(reminder_offsets_hours, 1) >= 1);
  END IF;
END $$;

-- 3. Validação dos valores do array (trigger; CHECK com subquery é proibido)
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

-- 4. ALTER patients
ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS reminders_opt_in BOOLEAN NOT NULL DEFAULT TRUE;

-- 5. CREATE TABLE appointment_reminders
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

-- 6. Indexes
CREATE INDEX IF NOT EXISTS appointment_reminders_tenant_created_idx
  ON public.appointment_reminders (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS appointment_reminders_tenant_appointment_idx
  ON public.appointment_reminders (tenant_id, appointment_id);
CREATE INDEX IF NOT EXISTS appointment_reminders_queued_idx
  ON public.appointment_reminders (status) WHERE status = 'queued';
CREATE UNIQUE INDEX IF NOT EXISTS appointment_reminders_idempotency
  ON public.appointment_reminders (appointment_id, scheduled_offset_hours, channel)
  WHERE is_manual = FALSE;

-- 7. RLS
ALTER TABLE public.appointment_reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS appointment_reminders_tenant_read ON public.appointment_reminders;
CREATE POLICY appointment_reminders_tenant_read ON public.appointment_reminders
  FOR SELECT TO authenticated
  USING (tenant_id = public.jwt_tenant_id());

GRANT SELECT ON public.appointment_reminders TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.appointment_reminders TO service_role;

-- 8. Trigger: audit (Princípio II)
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
      'channel=' || NEW.channel || ';appointment=' || NEW.appointment_id::TEXT
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

-- 9. Trigger: anti-mutation (enforce status transitions allowed)
CREATE OR REPLACE FUNCTION public.enforce_reminders_status_transition()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Apenas queued → sent/failed/skipped_* é permitido.
  IF OLD.status = 'queued' AND NEW.status IN (
    'sent', 'failed', 'skipped_opt_out', 'skipped_reversed', 'skipped_no_email', 'skipped_doctor_inactive'
  ) THEN
    RETURN NEW;
  END IF;
  -- Update de provider_message_id ou error sem mudar status: ok
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING
    MESSAGE = format('appointment_reminders status transition not allowed: %s → %s', OLD.status, NEW.status),
    ERRCODE = '23514';
END $$;

DROP TRIGGER IF EXISTS appointment_reminders_status_transition ON public.appointment_reminders;
CREATE TRIGGER appointment_reminders_status_transition
  BEFORE UPDATE ON public.appointment_reminders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_reminders_status_transition();

-- 10. Trigger: anti-delete (append-only)
CREATE OR REPLACE FUNCTION public.raise_no_delete_allowed()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING
    MESSAGE = 'DELETE not allowed on append-only table appointment_reminders',
    ERRCODE = '42501';
END $$;

DROP TRIGGER IF EXISTS appointment_reminders_no_delete ON public.appointment_reminders;
CREATE TRIGGER appointment_reminders_no_delete
  BEFORE DELETE ON public.appointment_reminders
  FOR EACH STATEMENT EXECUTE FUNCTION public.raise_no_delete_allowed();

-- 11. Comments
COMMENT ON TABLE public.appointment_reminders IS
  'Append-only. Cada tentativa de envio de lembrete. UNIQUE em (appointment_id, scheduled_offset_hours, channel) WHERE is_manual=FALSE garante idempotência do cron. Reenvios manuais (is_manual=TRUE) NUNCA são bloqueados por UNIQUE.';
COMMENT ON COLUMN public.appointment_reminders.scheduled_offset_hours IS
  'Antecedência configurada (horas). -1 reservado para envio manual fora do ciclo.';
COMMENT ON COLUMN public.tenant_clinic_profile.reminder_offsets_hours IS
  'Lista de antecedências em horas para envio de lembrete. Múltiplos valores = múltiplos lembretes (ex.: {48, 2}).';
```

## Test data considerations

- Seed mínimo: 1 tenant com `reminder_enabled=TRUE`, 1 paciente com email + opt-in, 1 appointment 24h no futuro → cron processa → 1 row em `appointment_reminders` com `status=sent` (mock Resend).
- Para isolation test: 2 tenants distintos, cada um com seu appointment elegível. Cron processa ambos; cada registro tem o `tenant_id` correto.
- Para idempotency test: rodar o motor 2x consecutivos; só 1 row gerada.
- Para opt-out test: paciente com `reminders_opt_in=FALSE` → row com `status='skipped_opt_out'`.

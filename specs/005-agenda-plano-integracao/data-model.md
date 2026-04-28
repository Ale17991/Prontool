# Phase 1 — Data Model: Integração agenda ↔ plano + conflito de horário

**Feature**: 005-agenda-plano-integracao
**Date**: 2026-04-28
**Migration**: `0055_appointment_conflict_and_completion.sql`

## Tabelas tocadas

### `appointments` (sem alteração de colunas)

A entidade central permanece imutável em estrutura. O que muda em torno dela: triggers novos e índices novos.

### `appointment_completions` (NEW)

Registra explicitamente que um atendimento foi realizado. Append-only.

```sql
CREATE TABLE public.appointment_completions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  appointment_id  UUID NOT NULL REFERENCES public.appointments(id) ON DELETE RESTRICT,
  completed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_by    UUID NOT NULL,
  source          TEXT NOT NULL CHECK (source IN ('plan_step', 'manual')),
  reason          TEXT,
  UNIQUE (tenant_id, appointment_id)  -- 1 completion por atendimento
);

CREATE INDEX appointment_completions_tenant_idx
  ON public.appointment_completions (tenant_id, completed_at DESC);
```

**Imutabilidade**:
- Trigger `appointment_completions_immutable` BEFORE UPDATE/DELETE → `RAISE EXCEPTION` (exceto para roles `postgres`/`supabase_admin`/`service_role`, padrão do repo).

**RLS**:
- SELECT: `tenant_id = current_tenant_id()` (helper já existente).
- INSERT: `tenant_id = current_tenant_id()` AND `appointments.tenant_id = NEW.tenant_id`.

**Audit**:
- Trigger `audit_appointment_completion_change` AFTER INSERT → INSERT em `audit_log` com `entity='appointments'`, `entity_id=appointment_id`, `field='effective_status'`, `old_value='agendado'`, `new_value='ativo'`, `actor=completed_by`, `reason=source||':'||reason`.

---

### `appointment_slot_locks` (NEW)

Índice derivado de "slots ocupados". Permite DELETE — não é registro financeiro.

```sql
CREATE TABLE public.appointment_slot_locks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  doctor_id       UUID NOT NULL REFERENCES public.doctors(id) ON DELETE RESTRICT,
  appointment_id  UUID NOT NULL UNIQUE REFERENCES public.appointments(id) ON DELETE RESTRICT,
  slot_range      TSTZRANGE NOT NULL,

  -- O VETO autoritativo de conflito.
  CONSTRAINT appointment_slot_locks_no_overlap
    EXCLUDE USING gist (
      tenant_id WITH =,
      doctor_id WITH =,
      slot_range WITH &&
    )
);

CREATE INDEX appointment_slot_locks_tenant_doctor_idx
  ON public.appointment_slot_locks USING gist (tenant_id, doctor_id, slot_range);
```

**RLS**:
- SELECT: `tenant_id = current_tenant_id()`.
- INSERT/DELETE: apenas via triggers (security definer) — RLS efetivamente fechada para clients.

---

### `treatment_plan_steps` (ALTER)

Acrescenta link 1:1 opcional com `appointments`. Column-guard relaxado para permitir UPDATE em `appointment_id` quando `OLD.appointment_id IS NULL` (one-shot link).

```sql
ALTER TABLE public.treatment_plan_steps
  ADD COLUMN IF NOT EXISTS appointment_id UUID NULL
    REFERENCES public.appointments(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS treatment_plan_steps_appointment_idx
  ON public.treatment_plan_steps (appointment_id)
  WHERE appointment_id IS NOT NULL;
```

Atualização do `enforce_treatment_plan_step_mutability`:
```sql
-- Pseudocódigo:
IF NEW.appointment_id IS DISTINCT FROM OLD.appointment_id THEN
  IF OLD.appointment_id IS NOT NULL THEN
    RAISE EXCEPTION 'appointment_id is immutable once set';
  END IF;
  -- one-shot link permitido; segue
END IF;
-- demais campos imutáveis: id, tenant_id, patient_id, procedure_id, plan_id,
-- title, notes, scheduled_date, created_by, created_at.
```

---

### `appointments_effective` (RECREATE VIEW)

Substitui a heurística de tempo da migration 0054 por status explícito.

```sql
CREATE OR REPLACE VIEW public.appointments_effective AS
SELECT
  a.*,
  CASE
    WHEN r.id IS NOT NULL THEN 'estornado'
    WHEN c.id IS NOT NULL THEN 'ativo'
    ELSE                      'agendado'
  END                                                                AS effective_status,
  (a.frozen_amount_cents + COALESCE(r.reversal_amount_cents, 0))     AS net_amount_cents,
  (
    (a.frozen_amount_cents + COALESCE(r.reversal_amount_cents, 0))
    * a.frozen_commission_bps / 10000
  )                                                                    AS net_commission_cents,
  r.id         AS reversal_id,
  r.created_at AS reversed_at,
  c.id         AS completion_id,
  c.completed_at,
  -- end derivado para uso em consumers que precisem do range completo
  (a.appointment_at + COALESCE(a.duration_minutes, 30) * interval '1 minute') AS appointment_ends_at
FROM public.appointments a
LEFT JOIN public.appointment_reversals r ON r.appointment_id = a.id
LEFT JOIN public.appointment_completions c ON c.appointment_id = a.id;
```

---

## Triggers (resumo)

| Trigger | Tabela | Quando | Ação |
|---|---|---|---|
| `appointments_create_slot_lock` | `appointments` | AFTER INSERT | INSERT em `appointment_slot_locks` (tenant, doctor, appointment_id, range derivado). EXCLUDE pode rejeitar — propaga 23P01 → API mapeia para HTTP 409. |
| `appointment_reversals_release_slot_lock` | `appointment_reversals` | AFTER INSERT | DELETE de `appointment_slot_locks WHERE appointment_id = NEW.appointment_id`. |
| `appointment_completions_immutable` | `appointment_completions` | BEFORE UPDATE/DELETE | RAISE (exceto roles privilegiadas). |
| `audit_appointment_completion_change` | `appointment_completions` | AFTER INSERT | INSERT em `audit_log`. |
| `step_status_sync_to_appointment` | `treatment_plan_steps` | AFTER UPDATE | Se `pg_trigger_depth() = 1` AND `appointment_id IS NOT NULL`: status `concluido` → INSERT em `appointment_completions` com `source='plan_step'`; status `cancelado` → INSERT em `appointment_reversals` com `reversal_amount_cents = -frozen_amount_cents`. |
| `appointment_completion_sync_to_step` | `appointment_completions` | AFTER INSERT | Se `pg_trigger_depth() = 1`: UPDATE `treatment_plan_steps SET status='concluido', completed_at=NEW.completed_at, completed_by=NEW.completed_by WHERE appointment_id = NEW.appointment_id`. |
| `appointment_reversal_sync_to_step` | `appointment_reversals` | AFTER INSERT | Se `pg_trigger_depth() = 1`: UPDATE `treatment_plan_steps SET status='cancelado' WHERE appointment_id = NEW.appointment_id`. |

---

## Funções

### `mark_appointment_realized(p_appointment_id UUID, p_by UUID, p_reason TEXT) RETURNS UUID`

Insere em `appointment_completions` (com source='manual'). Retorna o id da completion. Falha se já existe (UNIQUE) ou se o atendimento foi estornado.

```sql
CREATE OR REPLACE FUNCTION public.mark_appointment_realized(
  p_appointment_id UUID,
  p_by UUID,
  p_reason TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tenant_id UUID;
  v_completion_id UUID;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM public.appointments
  WHERE id = p_appointment_id;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'appointment % not found', p_appointment_id;
  END IF;

  IF EXISTS (SELECT 1 FROM public.appointment_reversals WHERE appointment_id = p_appointment_id) THEN
    RAISE EXCEPTION 'cannot mark reversed appointment as realized';
  END IF;

  INSERT INTO public.appointment_completions
    (tenant_id, appointment_id, completed_by, source, reason)
  VALUES (v_tenant_id, p_appointment_id, p_by, 'manual', p_reason)
  RETURNING id INTO v_completion_id;

  RETURN v_completion_id;
END $$;
```

### `create_step_with_appointment(p_tenant_id, p_patient_id, p_procedure_id, p_doctor_id, p_plan_id, p_appointment_at, p_duration_minutes, p_title, p_notes, p_created_by) RETURNS UUID`

Cria appointment + step linkados. Retorna `step_id`. Falha de qualquer um aborta tudo (transação implícita).

---

## Plano de rollback (dev)

Em ordem reversa para limpar a 0055:

```sql
DROP VIEW IF EXISTS public.appointments_effective;
-- Recriar versão da 0054 (status agendado por tempo).
DROP FUNCTION IF EXISTS public.mark_appointment_realized;
DROP FUNCTION IF EXISTS public.create_step_with_appointment;
DROP TRIGGER IF EXISTS appointment_reversal_sync_to_step ON public.appointment_reversals;
DROP TRIGGER IF EXISTS appointment_completion_sync_to_step ON public.appointment_completions;
DROP TRIGGER IF EXISTS step_status_sync_to_appointment ON public.treatment_plan_steps;
DROP TRIGGER IF EXISTS audit_appointment_completion_change ON public.appointment_completions;
DROP TRIGGER IF EXISTS appointment_completions_immutable ON public.appointment_completions;
DROP TRIGGER IF EXISTS appointment_reversals_release_slot_lock ON public.appointment_reversals;
DROP TRIGGER IF EXISTS appointments_create_slot_lock ON public.appointments;
DROP TABLE IF EXISTS public.appointment_slot_locks;
DROP TABLE IF EXISTS public.appointment_completions;
ALTER TABLE public.treatment_plan_steps DROP COLUMN IF EXISTS appointment_id;
-- btree_gist NÃO é dropada — outras features podem depender.
```

Em **prod, nunca rodar** o rollback — mantenha as estruturas. Remover dados via UPDATE/DELETE viola Princípio I.

---

## Índices novos

- `appointment_completions_tenant_idx (tenant_id, completed_at DESC)` — listagem de realizações por período.
- `appointment_slot_locks` GIST `(tenant_id, doctor_id, slot_range)` — backbone do veto de conflito; também acelera `/api/atendimentos/check-conflict`.
- `treatment_plan_steps_appointment_idx (appointment_id) WHERE appointment_id IS NOT NULL` — lookup reverso step↔appointment, usado pelos triggers de sync.

---

## RLS

`appointment_completions` e `appointment_slot_locks` recebem policies espelhadas de `appointments`:

```sql
ALTER TABLE public.appointment_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_slot_locks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_select" ON public.appointment_completions
  FOR SELECT USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);
-- (e equivalente para slot_locks; INSERT/DELETE controlado por triggers SECURITY DEFINER)
```

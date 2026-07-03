# Phase 1 — Data Model: Comprovantes 1:N + atendimento particular

**Feature**: 006-comprovantes-particular
**Date**: 2026-04-28
**Migration**: `0059_expense_receipts_table_and_particular.sql`

## Tabelas tocadas

### `expenses` (ALTER apenas no column-guard)

Sem mudança de schema. Colunas legadas `receipt_file_name`, `receipt_file_url`, `receipt_file_size` permanecem para back-compat até **0060** (PR separado, drop quando prod migrada).

`enforce_expenses_mutation` recriado para **proibir UPDATE** nessas 3 colunas a partir de 0059 (já não devem ser escritas pelo código novo). Continua permitindo UPDATE em `deleted_at` e `deleted_by` (soft-delete da despesa).

### `expense_receipts` (NEW)

Tabela canônica de comprovantes. Append + soft-delete (UPDATE só permitido nos campos `deleted_*`).

```sql
CREATE TABLE public.expense_receipts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  expense_id      UUID NOT NULL REFERENCES public.expenses(id) ON DELETE RESTRICT,
  file_name       TEXT NOT NULL,
  storage_path    TEXT NOT NULL UNIQUE,
  file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes BETWEEN 1 AND 10485760),
  content_type    TEXT NOT NULL,
  uploaded_by     UUID NOT NULL,
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ NULL,
  deleted_by      UUID NULL,
  deleted_reason  TEXT NULL
);

CREATE INDEX expense_receipts_expense_idx
  ON public.expense_receipts (expense_id, deleted_at);

CREATE INDEX expense_receipts_tenant_uploaded_idx
  ON public.expense_receipts (tenant_id, uploaded_at DESC);
```

**Imutabilidade** (apenas `deleted_*` mutável):

```sql
CREATE OR REPLACE FUNCTION public.enforce_expense_receipt_mutability()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('postgres','supabase_admin','service_role','supabase_auth_admin') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'expense_receipts: physical delete forbidden';
  END IF;
  IF NEW.id            IS DISTINCT FROM OLD.id
     OR NEW.tenant_id  IS DISTINCT FROM OLD.tenant_id
     OR NEW.expense_id IS DISTINCT FROM OLD.expense_id
     OR NEW.file_name  IS DISTINCT FROM OLD.file_name
     OR NEW.storage_path    IS DISTINCT FROM OLD.storage_path
     OR NEW.file_size_bytes IS DISTINCT FROM OLD.file_size_bytes
     OR NEW.content_type    IS DISTINCT FROM OLD.content_type
     OR NEW.uploaded_by     IS DISTINCT FROM OLD.uploaded_by
     OR NEW.uploaded_at     IS DISTINCT FROM OLD.uploaded_at THEN
    RAISE EXCEPTION 'expense_receipts: only deleted_at/deleted_by/deleted_reason are mutable';
  END IF;
  RETURN NEW;
END $$;
```

**RLS**:

- SELECT: `tenant_id = jwt_tenant_id()` (todos os 4 papéis com leitura de despesa).
- INSERT: bloqueado para clients (apenas via service_role na API). REVOKE INSERT.
- UPDATE: admin only — `jwt_role() = 'admin'` AND `tenant_id = jwt_tenant_id()`. GRANT UPDATE só nos 3 campos `deleted_*`.
- DELETE: bloqueado por trigger.

**Audit**:

- AFTER INSERT → log com `entity='expense_receipts', entity_id=id, field='upload', new_value=file_name`.
- AFTER UPDATE WHEN `OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL` → log `field='soft_delete', new_value=file_name, reason=NEW.deleted_reason`.

### `appointments` (ALTER plan_id NOT NULL → NULL)

```sql
ALTER TABLE public.appointments ALTER COLUMN plan_id DROP NOT NULL;
```

Idempotente. Atendimentos antigos têm `plan_id` preenchido — não muda. Apenas novos podem ter NULL.

Relaxar também a coluna `source_price_version_id` para nullable (atendimentos particulares não têm price_versions linkado):

```sql
ALTER TABLE public.appointments ALTER COLUMN source_price_version_id DROP NOT NULL;
```

### `appointments_effective` (RECREATE VIEW)

A view `appointments_effective` (vinda da feature 005) faz `SELECT a.*` — colunas nullable propagadas automaticamente. **Sem mudança DDL**.

### Trigger `enforce_appointment_preconditions` (recriado)

```sql
CREATE OR REPLACE FUNCTION public.enforce_appointment_preconditions()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  proc_tuss TEXT;
  tuss_valid_to DATE;
  active_price UUID;
BEGIN
  -- TUSS check (caminho comum)
  SELECT p.tuss_code INTO proc_tuss
  FROM public.procedures p
  WHERE p.id = NEW.procedure_id AND p.tenant_id = NEW.tenant_id;

  IF proc_tuss IS NULL THEN
    RAISE EXCEPTION 'APPOINTMENT_PROCEDURE_UNKNOWN: procedure not found in tenant'
      USING ERRCODE = '23514';
  END IF;

  SELECT valid_to INTO tuss_valid_to
  FROM public.tuss_codes WHERE code = proc_tuss;

  IF tuss_valid_to IS NOT NULL
     AND tuss_valid_to < (NEW.appointment_at AT TIME ZONE 'UTC')::date THEN
    RAISE EXCEPTION 'TUSS_CODE_RETIRED: code=% was retired on %', proc_tuss, tuss_valid_to
      USING ERRCODE = '23514';
  END IF;

  -- Price-version check (apenas com plan_id presente)
  IF NEW.plan_id IS NOT NULL THEN
    SELECT id INTO active_price
    FROM public.price_versions
    WHERE tenant_id = NEW.tenant_id
      AND procedure_id = NEW.procedure_id
      AND plan_id = NEW.plan_id
      AND valid_from <= (NEW.appointment_at AT TIME ZONE 'UTC')::date
    ORDER BY valid_from DESC, created_at DESC
    LIMIT 1;

    IF active_price IS NULL THEN
      RAISE EXCEPTION 'APPOINTMENT_PRICE_MISSING: no active price for (procedure, plan) on appointment date'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.source_price_version_id IS NULL THEN
      NEW.source_price_version_id := active_price;
    END IF;
  ELSE
    -- Caminho particular: source_price_version_id deve ser NULL.
    -- frozen_amount_cents > 0 ja garantido pelo CHECK na tabela.
    IF NEW.source_price_version_id IS NOT NULL THEN
      RAISE EXCEPTION 'APPOINTMENT_PARTICULAR_NO_PRICE_VERSION: plan_id is null but source_price_version_id was provided'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END $$;
```

### `treatment_plan_steps` (sem mudança schema)

`plan_id` já é nullable (vinda de 0032). Apenas a UI muda — checkbox em vez de sentinela `__none__`.

### Backfill 1:1 → 1:N

```sql
DO $$
DECLARE
  v_inserted INT := 0;
BEGIN
  INSERT INTO public.expense_receipts
    (tenant_id, expense_id, file_name, storage_path, file_size_bytes, content_type, uploaded_by, uploaded_at)
  SELECT
    tenant_id,
    id,
    receipt_file_name,
    receipt_file_url,
    receipt_file_size,
    'application/octet-stream',  -- conteudo desconhecido em registros legados
    created_by,
    created_at
  FROM public.expenses
  WHERE receipt_file_url IS NOT NULL
    AND receipt_file_size IS NOT NULL
    AND receipt_file_name IS NOT NULL
  ON CONFLICT (storage_path) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RAISE NOTICE '[0059 backfill] expense_receipts: % linhas migradas do single-receipt', v_inserted;
END $$;
```

`ON CONFLICT (storage_path) DO NOTHING` cobre o caso de a migration rodar duas vezes (idempotência).

### Column-guard `enforce_expenses_mutation` recriado

Para impedir novos writes nas colunas legadas:

```sql
CREATE OR REPLACE FUNCTION public.enforce_expenses_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('postgres','supabase_admin','service_role') THEN RETURN NEW; END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
     OR NEW.category IS DISTINCT FROM OLD.category
     OR NEW.competence_date IS DISTINCT FROM OLD.competence_date
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.supplier IS DISTINCT FROM OLD.supplier
     OR NEW.recurring IS DISTINCT FROM OLD.recurring
     OR NEW.frequency IS DISTINCT FROM OLD.frequency
     OR NEW.receipt_file_name IS DISTINCT FROM OLD.receipt_file_name
     OR NEW.receipt_file_url IS DISTINCT FROM OLD.receipt_file_url
     OR NEW.receipt_file_size IS DISTINCT FROM OLD.receipt_file_size THEN
    RAISE EXCEPTION
      'expenses: immutable record. Only soft-delete (deleted_at/deleted_by) is allowed. Use expense_receipts for attachments.';
  END IF;

  RETURN NEW;
END $$;
```

`GRANT UPDATE` revogado das colunas `receipt_file_*` (eram concedidas em 0058):

```sql
REVOKE UPDATE (receipt_file_name, receipt_file_url, receipt_file_size)
  ON public.expenses FROM authenticated;
```

## Plano de rollback (dev)

Em dev, ordem reversa:

```sql
DROP TABLE IF EXISTS public.expense_receipts CASCADE;
ALTER TABLE public.appointments ALTER COLUMN plan_id SET NOT NULL;       -- so funciona se nao houver NULLs
ALTER TABLE public.appointments ALTER COLUMN source_price_version_id SET NOT NULL;
-- Recriar o trigger 0015 da versao anterior (sem branch particular).
```

Em **prod, nunca rodar** — perda de dados de receipts e atendimentos particulares.

## Migration 0060 (futura, fora deste plan)

Quando confirmada paridade:

```sql
ALTER TABLE public.expenses
  DROP COLUMN IF EXISTS receipt_file_name,
  DROP COLUMN IF EXISTS receipt_file_url,
  DROP COLUMN IF EXISTS receipt_file_size;
-- Atualizar enforce_expenses_mutation removendo as 3 colunas da lista de imutaveis.
```

## RLS resumo

| Tabela             | SELECT            | INSERT            | UPDATE                   | DELETE     |
| ------------------ | ----------------- | ----------------- | ------------------------ | ---------- |
| `expense_receipts` | tenant_id matches | service_role only | admin only (deleted\_\*) | bloqueado  |
| `appointments`     | inalterado        | inalterado        | inalterado               | inalterado |
| `expenses`         | inalterado        | inalterado        | admin only (deleted\_\*) | bloqueado  |

Bucket `expense-receipts` (Storage) — sem mudança de policies; 0058 já cobre.

## Audit log entries esperadas

- `INSERT INTO expense_receipts` → `entity='expense_receipts', field='upload', new_value=file_name, actor=uploaded_by`
- `UPDATE expense_receipts SET deleted_at=now() ...` → `entity='expense_receipts', field='soft_delete', new_value=file_name, reason=deleted_reason, actor=deleted_by`
- `INSERT INTO appointments WITH plan_id=NULL` → herda audit existente (já fazendo entry por trigger de appointments).

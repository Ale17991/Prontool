# Phase 1 — Data Model

**Status**: completo. Define o schema SQL alvo (migration única), invariantes (CHECK, triggers, RLS) e como as novas entidades se conectam ao schema existente.

## Visão geral

| Tabela / RPC                              | Mudança                                            | Status                    |
| ----------------------------------------- | -------------------------------------------------- | ------------------------- |
| `public.tasks`                            | **NOVA**                                           | criar                     |
| `public.notifications`                    | **NOVA**                                           | criar                     |
| `public.doctors`                          | **ALTER** — `+ user_id UUID NULL` + UNIQUE parcial | acrescentar coluna        |
| `public.generate_user_notifications(...)` | **NOVA RPC** SECURITY DEFINER                      | criar                     |
| `public.audit_log`                        | _sem schema change_                                | uso via `log_audit_event` |

Tudo na migration única **`supabase/migrations/0078_tasks_notifications_user_link.sql`**.

---

## Entidade 1 — `public.tasks`

### Schema

```sql
CREATE TABLE public.tasks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  title         TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  notes         TEXT CHECK (notes IS NULL OR char_length(notes) <= 1000),
  due_date      DATE NOT NULL,
  assigned_to   UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  assigned_by   UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  priority      TEXT NOT NULL CHECK (priority IN ('baixa','normal','alta','urgente')),
  status        TEXT NOT NULL DEFAULT 'pendente'
                  CHECK (status IN ('pendente','concluida')),
  completed_at  TIMESTAMPTZ,
  completed_by  UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  deleted_at    TIMESTAMPTZ,
  deleted_by    UUID REFERENCES auth.users(id) ON DELETE RESTRICT,

  -- Invariante: completed_at/completed_by coerentes com status.
  CONSTRAINT tasks_completion_check CHECK (
    (status = 'concluida' AND completed_at IS NOT NULL AND completed_by IS NOT NULL)
    OR
    (status = 'pendente' AND completed_at IS NULL AND completed_by IS NULL)
  )
);
```

### Índices

```sql
-- Listagem por tenant + status (filtros mais comuns).
CREATE INDEX tasks_tenant_status_idx
  ON public.tasks (tenant_id, status, due_date)
  WHERE deleted_at IS NULL;

-- Filtro por responsável (admin filtra outros; demais veem só as suas).
CREATE INDEX tasks_assigned_to_idx
  ON public.tasks (tenant_id, assigned_to, due_date)
  WHERE deleted_at IS NULL;

-- Localização rápida de atrasadas (filtro UI).
CREATE INDEX tasks_overdue_idx
  ON public.tasks (tenant_id, assigned_to, due_date)
  WHERE deleted_at IS NULL AND status = 'pendente';
```

### Invariantes

| ID     | Invariante                                                                                      | Mecanismo                                            |
| ------ | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| INV-T1 | `title` 1–200 chars                                                                             | CHECK                                                |
| INV-T2 | `notes` ≤ 1000 chars ou NULL                                                                    | CHECK                                                |
| INV-T3 | `priority` ∈ {baixa, normal, alta, urgente}                                                     | CHECK                                                |
| INV-T4 | `status` ∈ {pendente, concluida}                                                                | CHECK                                                |
| INV-T5 | Coerência `status ↔ completed_*`                                                                | CHECK composto                                       |
| INV-T6 | Colunas core (id/tenant/title/due_date/assigned_to/assigned_by/created_at/created_by) imutáveis | trigger `enforce_tasks_mutation`                     |
| INV-T7 | DELETE físico bloqueado                                                                         | trigger `enforce_append_only`                        |
| INV-T8 | Toda mudança auditada                                                                           | trigger `audit_tasks_change` chama `log_audit_event` |
| INV-T9 | Leitura/escrita filtrada por RLS                                                                | policies `tasks_*`                                   |

### Trigger de imutabilidade

```sql
CREATE OR REPLACE FUNCTION public.enforce_tasks_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('postgres','supabase_admin','service_role') THEN RETURN NEW; END IF;
  IF NEW.id          IS DISTINCT FROM OLD.id
     OR NEW.tenant_id   IS DISTINCT FROM OLD.tenant_id
     OR NEW.title       IS DISTINCT FROM OLD.title
     OR NEW.due_date    IS DISTINCT FROM OLD.due_date
     OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
     OR NEW.assigned_by IS DISTINCT FROM OLD.assigned_by
     OR NEW.created_at  IS DISTINCT FROM OLD.created_at
     OR NEW.created_by  IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'tasks: campos core imutáveis (audit history integrity)';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER tasks_immutable_columns
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.enforce_tasks_mutation();

CREATE TRIGGER tasks_no_physical_delete
  BEFORE DELETE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only();
```

### Trigger de auditoria

```sql
CREATE OR REPLACE FUNCTION public.audit_tasks_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'tasks', NEW.id, 'created',
      NULL,
      format('%s|prioridade=%s|prazo=%s|para=%s', NEW.title, NEW.priority, NEW.due_date, NEW.assigned_to),
      'task-created'
    );
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'tasks', NEW.id,
      'status', OLD.status, NEW.status,
      CASE WHEN NEW.status='concluida' THEN 'task-completed' ELSE 'task-reopened' END
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

CREATE TRIGGER tasks_audit
  AFTER INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.audit_tasks_change();
```

### RLS

```sql
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

-- Admin vê tudo do tenant; demais só onde são responsáveis.
CREATE POLICY tasks_read ON public.tasks FOR SELECT
  USING (
    tenant_id = public.jwt_tenant_id()
    AND (public.jwt_role() = 'admin' OR assigned_to = auth.uid())
  );

-- Admin pode criar para qualquer responsável; demais só com assigned_to = self.
CREATE POLICY tasks_insert ON public.tasks FOR INSERT
  WITH CHECK (
    tenant_id = public.jwt_tenant_id()
    AND (public.jwt_role() = 'admin' OR assigned_to = auth.uid())
  );

-- Admin update tudo; demais só onde são responsáveis.
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
```

---

## Entidade 2 — `public.notifications`

### Schema

```sql
CREATE TABLE public.notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN (
                    'atendimento','tarefa','tarefa_atrasada','aniversarios_mes'
                  )),
  title           TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  body            TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  reference_id   UUID NULL,        -- FK conceitual (sem REFERENCES) — preserva quando referência é soft-deleted
  reference_type  TEXT NULL CHECK (reference_type IS NULL OR reference_type IN ('appointment','task','month')),
  reference_key   TEXT NOT NULL CHECK (char_length(reference_key) BETWEEN 1 AND 100),
  is_read         BOOLEAN NOT NULL DEFAULT FALSE,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Coerência is_read ↔ read_at
  CONSTRAINT notifications_read_check CHECK (
    (is_read = TRUE AND read_at IS NOT NULL)
    OR
    (is_read = FALSE AND read_at IS NULL)
  )
);
```

### Índices

```sql
-- Idempotência: previne duplicatas. Chave natural por tipo.
CREATE UNIQUE INDEX notifications_dedup_unique
  ON public.notifications (tenant_id, user_id, type, reference_key);

-- Listagem da página: por usuário + ordenado por created_at desc.
CREATE INDEX notifications_user_created_idx
  ON public.notifications (tenant_id, user_id, created_at DESC);

-- Badge no sininho: contagem de não lidas é hot path.
CREATE INDEX notifications_unread_idx
  ON public.notifications (tenant_id, user_id)
  WHERE is_read = FALSE;
```

### Invariantes

| ID     | Invariante                                                        | Mecanismo                                |
| ------ | ----------------------------------------------------------------- | ---------------------------------------- |
| INV-N1 | `type` ∈ {atendimento, tarefa, tarefa_atrasada, aniversarios_mes} | CHECK                                    |
| INV-N2 | `title` 1–200 chars; `body` 1–2000 chars                          | CHECK                                    |
| INV-N3 | `reference_type` ∈ {appointment, task, month} ou NULL             | CHECK                                    |
| INV-N4 | UNIQUE `(tenant_id, user_id, type, reference_key)` — idempotência | INDEX                                    |
| INV-N5 | Coerência `is_read ↔ read_at`                                     | CHECK composto                           |
| INV-N6 | RLS: usuário vê apenas as suas                                    | policy `notifications_user_only`         |
| INV-N7 | DELETE físico bloqueado                                           | trigger `enforce_append_only`            |
| INV-N8 | Mutáveis: apenas `is_read`, `read_at`                             | trigger `enforce_notifications_mutation` |

### Triggers

```sql
CREATE OR REPLACE FUNCTION public.enforce_notifications_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('postgres','supabase_admin','service_role') THEN RETURN NEW; END IF;
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

CREATE TRIGGER notifications_immutable_columns
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.enforce_notifications_mutation();

CREATE TRIGGER notifications_no_physical_delete
  BEFORE DELETE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only();
```

### RLS

```sql
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY notifications_user_only ON public.notifications FOR SELECT
  USING (tenant_id = public.jwt_tenant_id() AND user_id = auth.uid());

CREATE POLICY notifications_user_update ON public.notifications FOR UPDATE
  USING (tenant_id = public.jwt_tenant_id() AND user_id = auth.uid())
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND user_id = auth.uid());

REVOKE INSERT, UPDATE, DELETE ON public.notifications FROM authenticated;
GRANT SELECT ON public.notifications TO authenticated;
GRANT UPDATE (is_read, read_at) ON public.notifications TO authenticated;
-- INSERT é feito apenas via RPC SECURITY DEFINER `generate_user_notifications`.
```

---

## Entidade 3 — `public.doctors` (extensão)

### Mudança

```sql
ALTER TABLE public.doctors
  ADD COLUMN IF NOT EXISTS user_id UUID NULL
    REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS doctors_user_id_unique_idx
  ON public.doctors (tenant_id, user_id)
  WHERE user_id IS NOT NULL;
```

### Trigger de auditoria

```sql
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

CREATE TRIGGER doctors_user_link_audit
  AFTER UPDATE OF user_id ON public.doctors
  FOR EACH ROW EXECUTE FUNCTION public.audit_user_doctor_link();
```

### Invariantes

| ID     | Invariante                       | Mecanismo                                      |
| ------ | -------------------------------- | ---------------------------------------------- |
| INV-D1 | Um doctor referencia ≤ 1 usuário | UNIQUE parcial                                 |
| INV-D2 | Cross-tenant blocked             | UNIQUE por (tenant_id, user_id) WHERE NOT NULL |
| INV-D3 | Mudança auditada                 | trigger `audit_user_doctor_link`               |

---

## RPC `generate_user_notifications`

### Assinatura

```sql
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
  -- 1. Validação básica: o user_id pertence ao tenant_id.
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
      a.doctor_id,
      a.procedure_id,
      a.patient_id,
      d.full_name AS doctor_name,
      p.tuss_code,
      p.display_name AS procedure_name
    FROM public.appointments_effective a
    JOIN public.doctors d ON d.id = a.doctor_id
    JOIN public.procedures p ON p.id = a.procedure_id
    WHERE a.tenant_id = p_tenant_id
      AND DATE(a.appointment_at AT TIME ZONE 'UTC') = v_today
      AND a.effective_status IN ('agendado','ativo')
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
  --    Chave caller deve setar `app.encryption_key` (PATIENT_DATA_ENCRYPTION_KEY)
  --    antes desta RPC. Sem chave: pula sem erro (não bloqueia outras categorias).
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
```

### Como o caller invoca

```ts
// dentro do route handler GET /api/notificacoes
const session = await requireRole([...])
const sb = createSupabaseServiceClient()
// Seta a chave de criptografia para a RPC poder decifrar birth_date
await sb.rpc('set_patient_encryption_key_for_test' as never) // ou via SET LOCAL session-scoped
// (na prática usar mesmo helper que `decrypt_patient_names_for_ids` já usa)
await sb.rpc('generate_user_notifications' as never, {
  p_tenant_id: session.tenantId,
  p_user_id: session.userId,
})
const notifications = await listNotifications(sb, { tenantId, userId })
```

> A chave de criptografia é passada de forma session-scoped (já usado em decryption de pacientes). RPC ignora silenciosamente se chave não setada — só gera as 3 categorias não dependentes de cifra.

---

## Diagrama lógico

```
+---------------+         +---------------+         +---------------+
|   tenants     |         |  auth.users   |         |   patients    |
+-------+-------+         +-------+-------+         +-------+-------+
        ^                         ^                         ^
        |                         |                         |
        |       +-------------------------------+           |
        |       |                               |           |
+-------+-------+         +------+-----+        |           |
|   tasks       |         |  doctors   |        |   +-------+-------+
+---------------+         +------------+        |   | appointments  |
| id  PK        |         | id  PK     |        |   +---------------+
| tenant_id  -->          | tenant_id->|        |          ^
| title         |         | user_id ★->|        |          |
| due_date      |         | full_name  |        |          |
| assigned_to ->|         +------------+        |          |
| status        |                               |          |
| completed_at  |                               |          |
| ...           |                               |          |
+---------------+                               |          |
                                                |          |
                                       +--------+----------+----+
                                       |   notifications        |
                                       +------------------------+
                                       | id  PK                 |
                                       | tenant_id -->          |
                                       | user_id  -->           |
                                       | type ∈ {atendimento,   |
                                       |   tarefa,              |
                                       |   tarefa_atrasada,     |
                                       |   aniversarios_mes}    |
                                       | reference_id (uuid, FK |
                                       |   conceitual)          |
                                       | reference_key  (text — |
                                       |   chave natural        |
                                       |   idempotência)        |
                                       | is_read / read_at      |
                                       +------------------------+

★ Coluna nova adicionada por esta feature.

Geração lazy: generate_user_notifications(tenant, user) lê tasks, appointments,
patients (decifrando birth_date) e popula notifications via UPSERT idempotente.
```

---

## Mapeamento Spec → Schema

| Spec requirement                   | Schema artifact                                                         |
| ---------------------------------- | ----------------------------------------------------------------------- |
| FR-001 (campos da tarefa)          | `tasks` columns                                                         |
| FR-002 (filtros listagem)          | índices + service layer                                                 |
| FR-003 (destaque atrasadas)        | service projeta `is_overdue = (status='pendente' AND due_date < today)` |
| FR-004 (concluir/reabrir)          | trigger imutabilidade permite mutar status + completed\_\*              |
| FR-005 (RLS por papel)             | policies `tasks_read/insert/update`                                     |
| FR-006 (audit tarefas)             | trigger `audit_tasks_change`                                            |
| FR-007 (soft-delete admin)         | `deleted_at` column + service layer `requireRole('admin')`              |
| FR-008–FR-010 (geração 4 tipos)    | RPC `generate_user_notifications`                                       |
| FR-011 (idempotência)              | UNIQUE `notifications_dedup_unique` + ON CONFLICT DO NOTHING            |
| FR-012 (campos notif)              | `notifications` columns                                                 |
| FR-013 (RLS notif)                 | policy `notifications_user_only`                                        |
| FR-014 (badge sininho)             | `notifications_unread_idx` + `GET /api/notificacoes/unread-count`       |
| FR-015–FR-017 (página + mark read) | service layer + UI                                                      |
| FR-018 (sidebar)                   | dashboard-shell                                                         |
| FR-019–FR-027 (cadastro manual)    | service layer + auth.admin.createUser + doctors.user_id                 |
| FR-028–FR-029 (multi-tenant)       | RLS + UNIQUE parcial doctors                                            |

---

## Estados / Transições

### `tasks`

```
       (criação por admin ou self)
                 │
                 v
        +---- pendente ----+
        |                  |
        |  Concluir        |  Soft-delete (admin only)
        v                  v
    concluida          deleted (deleted_at NOT NULL,
        |               some das listagens)
        |
        |  Reabrir
        v
     pendente
```

- Toda transição **gera audit**.
- Sem DELETE físico.

### `notifications`

```
   (gerada pela RPC)
        │
        v
   is_read=false  ───[clicar / Marcar lidas]──>  is_read=true, read_at=now
                                                        │
                                                        │ (sem retorno —
                                                        │   re-leitura não desfaz)
                                                        v
                                              permanece como histórico
```

- Sem DELETE físico.
- Geração é idempotente (não recria; só `is_read` é mutável).

---

## Concorrência

- Dois requests simultâneos do mesmo usuário disparando `generate_user_notifications`: UNIQUE INDEX + `ON CONFLICT DO NOTHING` garante zero duplicatas. RPC retorna `inserted_*: 0` no segundo request.
- Dois admins criando tarefas para o mesmo responsável: sem conflito (cada tarefa é nova row).
- Vinculação simultânea de dois usuários ao mesmo doctor: UNIQUE parcial bloqueia o segundo com erro `23505` → service traduz para `ConflictError('DOCTOR_ALREADY_LINKED')`.
- Criação de usuário com email duplicado: `auth.admin.createUser` retorna erro; service traduz para `ConflictError('USER_ALREADY_EXISTS')`.

---

## Considerações de tipos TS

```ts
type TaskRow = {
  id: string
  tenant_id: string
  title: string
  notes: string | null
  due_date: string // YYYY-MM-DD
  assigned_to: string
  assigned_by: string
  priority: 'baixa' | 'normal' | 'alta' | 'urgente'
  status: 'pendente' | 'concluida'
  completed_at: string | null
  completed_by: string | null
  created_at: string
  created_by: string
  deleted_at: string | null
  deleted_by: string | null
}

type NotificationRow = {
  id: string
  tenant_id: string
  user_id: string
  type: 'atendimento' | 'tarefa' | 'tarefa_atrasada' | 'aniversarios_mes'
  title: string
  body: string
  reference_id: string | null
  reference_type: 'appointment' | 'task' | 'month' | null
  reference_key: string
  is_read: boolean
  read_at: string | null
  created_at: string
}

// doctors ganha:  user_id: string | null
```

---

## Pronto para Phase 1 de contratos

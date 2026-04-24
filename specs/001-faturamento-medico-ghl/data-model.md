# Phase 1 Data Model: Faturamento Médico GHL/Homio

**Date**: 2026-04-16
**Feature**: [spec.md](./spec.md)
**Plan**: [plan.md](./plan.md)

Domain entities, attributes, relationships, constraints, RLS policies, and
state transitions. All tenant-scoped tables carry `tenant_id UUID NOT NULL`
with RLS and defense-in-depth append-only triggers where applicable.

Conventions:
- Money stored as `BIGINT` cents (BRL). Never float.
- Timestamps `TIMESTAMPTZ` in UTC.
- PKs are `UUID` (pgcrypto `gen_random_uuid()`), not serial.
- Soft-delete forbidden in financial tables; status derived via
  append-only records (see Atendimento + Reversão).

---

## 1. Global catalogs (no RLS — read-only to all tenants)

### `tuss_codes`

Catálogo oficial TUSS. Única fonte autoritativa de códigos de procedimento.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | `gen_random_uuid()` |
| `code` | TEXT NOT NULL UNIQUE | Código TUSS oficial (ex. `10101012`) |
| `description` | TEXT NOT NULL | Descrição oficial |
| `terminology_chapter` | TEXT | Capítulo/seção do padrão |
| `valid_from` | DATE NOT NULL | Início de vigência oficial ANS |
| `valid_to` | DATE NULL | NULL = vigente; data = descontinuado |
| `source_catalog_version_id` | UUID FK → `tuss_catalog_versions(id)` | Rastreio do snapshot |
| `created_at` | TIMESTAMPTZ DEFAULT now() | |

**Indexes**: `code`, `(valid_from, valid_to)`.

### `tuss_catalog_versions`

Rastreio de snapshots do catálogo importado de
`charlesfgarcia/tabelas-ans` — apoia detecção de divergência (FR
implícita via Edge Case "Divergência no catálogo TUSS global").

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `source_ref` | TEXT NOT NULL | Commit SHA do repositório-fonte |
| `imported_at` | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| `imported_by` | UUID | Operador da plataforma |
| `content_hash` | TEXT NOT NULL | SHA256 do dump gerado |
| `code_count` | INTEGER NOT NULL | |
| `notes` | TEXT | |

---

## 2. Identity & tenant (governed by Supabase Auth)

### `tenants` (clínicas)

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `name` | TEXT NOT NULL | Nome fantasia da clínica |
| `slug` | TEXT NOT NULL UNIQUE | Identificador URL-safe |
| `status` | TEXT NOT NULL DEFAULT 'active' | `active`/`suspended` |
| `timezone` | TEXT NOT NULL DEFAULT 'America/Sao_Paulo' | |
| `created_at` | TIMESTAMPTZ DEFAULT now() | |

**RLS**: admin de plataforma lê tudo; tenant lê apenas o próprio.

### `user_tenants`

Vínculo N:N entre `auth.users` e `tenants` com role.

| Column | Type | Notes |
|--------|------|-------|
| `user_id` | UUID FK → `auth.users(id)` | |
| `tenant_id` | UUID FK → `tenants(id)` | |
| `role` | TEXT NOT NULL | `admin`/`financeiro`/`recepcionista`/`profissional_saude` |
| `created_at` | TIMESTAMPTZ DEFAULT now() | |
| PK | (user_id, tenant_id) | |

**Auth Hook**: ao autenticar, JWT recebe custom claims `tenant_id` e
`role` vindos desta tabela (usuário escolhe tenant ativo no login se tiver
múltiplos vínculos).

### `tenant_ghl_config`

Configuração de integração GHL por tenant (FR-014 de research).

| Column | Type | Notes |
|--------|------|-------|
| `tenant_id` | UUID PK FK → `tenants(id)` | |
| `webhook_secret` | BYTEA NOT NULL | Criptografado (pgcrypto) — valida HMAC do GHL |
| `trigger_stage_name` | TEXT NOT NULL | Nome exato da etapa GHL que dispara faturamento |
| `field_map_plano` | TEXT NOT NULL | Nome do custom field GHL com o plano |
| `field_map_procedimento_tuss` | TEXT NOT NULL | |
| `field_map_medico_identifier` | TEXT NOT NULL | |
| `field_map_patient_name` | TEXT NOT NULL | |
| `field_map_patient_cpf` | TEXT NOT NULL | |
| `field_map_patient_phone` | TEXT NOT NULL | |
| `field_map_patient_email` | TEXT NOT NULL | |
| `field_map_patient_birth_date` | TEXT NOT NULL | |
| `field_map_appointment_timestamp` | TEXT | Opcional; fallback = event receipt |
| `updated_at` | TIMESTAMPTZ DEFAULT now() | |

**RLS**: read/write apenas para `role='admin'` do próprio tenant.

---

## 3. Clínica — cadastros básicos

### `procedures`

Procedimentos que a clínica oferece (subset do `tuss_codes` global).

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `tenant_id` | UUID NOT NULL | RLS |
| `tuss_code` | TEXT NOT NULL | FK lógica → `tuss_codes.code` (validada em INSERT) |
| `display_name` | TEXT | Alias interno opcional |
| `active` | BOOLEAN NOT NULL DEFAULT true | |
| `created_at` | TIMESTAMPTZ DEFAULT now() | |
| `created_by` | UUID FK → `auth.users` | |
| UNIQUE | (tenant_id, tuss_code) | |

**RLS**: SELECT por tenant; INSERT/UPDATE apenas role `admin`.

**Audit trigger**: INSERT e UPDATE do campo `active` → `audit_log`.

### `health_plans`

Planos aceitos pela clínica (Unimed, Bradesco, Amil, Particular, etc.).

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `tenant_id` | UUID NOT NULL | |
| `name` | TEXT NOT NULL | |
| `active` | BOOLEAN NOT NULL DEFAULT true | |
| `created_at` | TIMESTAMPTZ DEFAULT now() | |
| `created_by` | UUID | |
| UNIQUE | (tenant_id, name) | |

**RLS**: SELECT por tenant; INSERT/UPDATE apenas role `admin`.

### `doctors`

Médicos da clínica. Campo `commission_current_pct` é somente-leitura
derivado do head de `doctor_commission_history` (view ou coluna mantida
por trigger). Alterações de comissão criam nova linha em history.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `tenant_id` | UUID NOT NULL | |
| `full_name` | TEXT NOT NULL | |
| `crm` | TEXT NOT NULL | Registro CRM-UF |
| `external_identifier` | TEXT | Referência que aparece no GHL custom field |
| `active` | BOOLEAN NOT NULL DEFAULT true | |
| `created_at` | TIMESTAMPTZ DEFAULT now() | |
| `created_by` | UUID | |
| UNIQUE | (tenant_id, crm) | |
| UNIQUE | (tenant_id, external_identifier) where not null | |

### `doctor_commission_history` (append-only)

Histórico de comissões do médico. Nunca atualiza; cada alteração cria
nova linha.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `tenant_id` | UUID NOT NULL | |
| `doctor_id` | UUID FK → `doctors(id)` | |
| `percentage_bps` | INTEGER NOT NULL | Basis points: 4000 = 40.00% |
| `valid_from` | DATE NOT NULL | |
| `created_at` | TIMESTAMPTZ DEFAULT now() | |
| `created_by` | UUID | |
| `reason` | TEXT NOT NULL | |
| UNIQUE | (tenant_id, doctor_id, valid_from) | |

**Append-only**: grant `SELECT, INSERT` apenas; trigger bloqueia UPDATE/DELETE.
**Audit**: trigger AFTER INSERT → `audit_log`.

**Derived view**: `doctor_commission_current` expõe head por médico.

---

## 4. Tabela de preços — vigências append-only

### `price_versions` (append-only)

Versões de preço por (procedimento, plano). Chain semântica: dada uma
combinação (tenant, proc, plan), a head é a linha com maior `valid_from`
(desempate por `created_at`).

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `tenant_id` | UUID NOT NULL | |
| `procedure_id` | UUID FK → `procedures(id)` | |
| `plan_id` | UUID FK → `health_plans(id)` | |
| `amount_cents` | BIGINT NOT NULL CHECK (amount_cents >= 0) | |
| `valid_from` | DATE NOT NULL | |
| `created_at` | TIMESTAMPTZ DEFAULT now() | |
| `created_by` | UUID NOT NULL | |
| `reason` | TEXT NOT NULL | FR-005 |
| `previous_version_id` | UUID FK → `price_versions(id)` | NULL apenas no primeiro da chain |
| UNIQUE | (tenant_id, procedure_id, plan_id, valid_from) | Colisão de concorrência |

**Append-only**: grant `SELECT, INSERT`; trigger bloqueia UPDATE/DELETE.

**Audit**: trigger AFTER INSERT → `audit_log` com valor anterior tomado de
`previous_version_id`.

**Concurrency (FR-005a/b)**: INSERT é executado em transação que valida
`previous_version_id = (current head id)` ou responde 409.

**Resolve active price for date D**:
```sql
SELECT *
FROM price_versions
WHERE tenant_id = $1 AND procedure_id = $2 AND plan_id = $3
  AND valid_from <= $D
ORDER BY valid_from DESC, created_at DESC
LIMIT 1;
```

**`valid_to` derivado**: não persistido; calculado em views como
`LEAD(valid_from) OVER (...) - INTERVAL '1 day'`.

---

## 5. Pacientes (LGPD — criptografia coluna)

### `patients`

Paciente replicado do GHL (FR-010a–c).

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `tenant_id` | UUID NOT NULL | |
| `ghl_contact_id` | TEXT NOT NULL | Identificador externo do GHL |
| `full_name_enc` | BYTEA NOT NULL | pgcrypto |
| `cpf_enc` | BYTEA NOT NULL | pgcrypto |
| `phone_enc` | BYTEA | |
| `email_enc` | BYTEA | |
| `birth_date_enc` | BYTEA | |
| `anonymized_at` | TIMESTAMPTZ | Política LGPD de retenção |
| `created_at` | TIMESTAMPTZ DEFAULT now() | |
| `updated_at` | TIMESTAMPTZ DEFAULT now() | |
| UNIQUE | (tenant_id, ghl_contact_id) | |

**RLS**: read apenas por usuários autenticados do mesmo tenant; campos
criptografados decriptados via view `patients_decrypted` que aplica RLS
por role (recepcionista vê nome + aniversário; financeiro vê tudo
necessário; admin vê tudo).

**Não-append-only**: este é o único cadastro de dados pessoais que
permite UPDATE (refletir mudança no GHL — FR-010b); DELETE proibido
(retenção LGPD controlada por processo central).

**Audit**: trigger AFTER INSERT OR UPDATE → `audit_log` marcando apenas
**quais campos** foram alterados (nunca valores em claro).

---

## 6. Atendimentos — núcleo financeiro append-only

### `appointments` (append-only, imutável)

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `tenant_id` | UUID NOT NULL | |
| `patient_id` | UUID FK → `patients(id)` | |
| `doctor_id` | UUID FK → `doctors(id)` | |
| `procedure_id` | UUID FK → `procedures(id)` | |
| `plan_id` | UUID FK → `health_plans(id)` | |
| `frozen_amount_cents` | BIGINT NOT NULL | Preço vigente na data do atendimento, congelado |
| `frozen_commission_bps` | INTEGER NOT NULL | % de comissão vigente, congelado (basis points) |
| `source_price_version_id` | UUID FK → `price_versions(id)` | Rastreio da versão usada |
| `source_commission_history_id` | UUID FK → `doctor_commission_history(id)` | |
| `appointment_at` | TIMESTAMPTZ NOT NULL | Timestamp do atendimento |
| `source` | TEXT NOT NULL DEFAULT 'ghl' | `ghl`, `manual` (futuro) |
| `source_raw_event_id` | UUID FK → `raw_webhook_events(id)` | UNIQUE when not null |
| `created_at` | TIMESTAMPTZ DEFAULT now() | |
| UNIQUE | (tenant_id, source_raw_event_id) where source_raw_event_id is not null | Idempotência FR-014 |

**Append-only**: grant `SELECT, INSERT`; trigger bloqueia UPDATE/DELETE.

**Audit**: trigger AFTER INSERT → `audit_log` (criação de atendimento é
evento auditável).

### `appointment_reversals` (append-only)

Registros de reversão — compensação sem mutar o original (FR-027–32).

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `tenant_id` | UUID NOT NULL | |
| `appointment_id` | UUID FK → `appointments(id)` | Original |
| `reversal_amount_cents` | BIGINT NOT NULL CHECK (reversal_amount_cents < 0) | Sinal oposto |
| `reason` | TEXT NOT NULL | FR-027 |
| `created_at` | TIMESTAMPTZ DEFAULT now() | |
| `created_by` | UUID NOT NULL | Papel admin ou financeiro (FR-032) |
| UNIQUE | (tenant_id, appointment_id) | Um atendimento só pode ser revertido uma vez |

**Append-only + Audit**: idem pattern.

### `appointments_effective` (VIEW derivada, não persistida)

Expõe status e valor líquido em tempo de consulta (FR-029, FR-030).

```sql
CREATE VIEW appointments_effective AS
SELECT
  a.*,
  CASE WHEN r.id IS NULL THEN 'ativo' ELSE 'estornado' END AS effective_status,
  a.frozen_amount_cents + COALESCE(r.reversal_amount_cents, 0) AS net_amount_cents,
  a.frozen_amount_cents * a.frozen_commission_bps / 10000 +
    COALESCE(r.reversal_amount_cents, 0) * a.frozen_commission_bps / 10000 AS net_commission_cents,
  r.id AS reversal_id,
  r.created_at AS reversed_at
FROM appointments a
LEFT JOIN appointment_reversals r ON r.appointment_id = a.id;
```

Usada por `src/lib/core/appointments/effective-status.ts`, telas e
relatórios.

---

## 7. Ingestão de webhook & DLQ

### `raw_webhook_events` (append-only)

Log bruto de todos os eventos GHL aceitos (FR-008a).

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `tenant_id` | UUID NOT NULL | Derivado do secret do webhook |
| `ghl_event_id` | TEXT NOT NULL | ID único do evento na origem |
| `payload` | JSONB NOT NULL | Payload completo |
| `headers` | JSONB NOT NULL | Incl. assinatura (apenas hash, não o token) |
| `received_at` | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| `processing_status` | TEXT NOT NULL DEFAULT 'pending' | `pending`/`processing`/`done`/`dlq`/`reprocessed` |
| `last_processed_at` | TIMESTAMPTZ | |
| `processing_attempt_count` | INTEGER NOT NULL DEFAULT 0 | |
| UNIQUE | (tenant_id, ghl_event_id) | Idempotência FR-014 |

**Append-only para `payload`, `headers`, `received_at`, `ghl_event_id`,
`tenant_id`**; `processing_status` e campos de estado de processamento
**são mutáveis** (exceção documentada à Principle I: estado operacional,
não dado financeiro). Transições registradas em `webhook_event_transitions`.

### `webhook_event_transitions` (append-only)

Rastro append-only do ciclo de vida de cada evento.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `tenant_id` | UUID NOT NULL | |
| `raw_event_id` | UUID FK → `raw_webhook_events(id)` | |
| `from_status` | TEXT | |
| `to_status` | TEXT NOT NULL | |
| `reason` | TEXT | |
| `transitioned_at` | TIMESTAMPTZ DEFAULT now() | |
| `actor` | TEXT | `worker`/`admin:<user_id>` |

### `dlq_events` (view ou tabela) — **decisão: view**

```sql
CREATE VIEW dlq_events AS
SELECT
  r.*,
  (SELECT reason FROM webhook_event_transitions t
    WHERE t.raw_event_id = r.id AND t.to_status = 'dlq'
    ORDER BY t.transitioned_at DESC LIMIT 1) AS failure_reason
FROM raw_webhook_events r
WHERE r.processing_status = 'dlq';
```

**Reprocessamento**: admin do tenant chama POST
`/api/alertas/dlq/{id}/reprocess` → enfileira novamente em QStash;
transição `dlq → processing` registrada.

---

## 8. Alertas operacionais

### `alerts` (append-only para criação; `status` mutável)

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `tenant_id` | UUID NOT NULL | |
| `type` | TEXT NOT NULL | Enum: `dlq_event`, `webhook_rejected`, `tuss_deprecated`, `signature_failure`, `rbac_denied` |
| `subject_ref` | JSONB | ID do evento/entidade relacionado |
| `detail` | JSONB NOT NULL | Informação para diagnóstico; **sem PII** |
| `status` | TEXT NOT NULL DEFAULT 'aberto' | `aberto`/`resolvido` |
| `created_at` | TIMESTAMPTZ DEFAULT now() | |
| `resolved_at` | TIMESTAMPTZ | |
| `resolved_by` | UUID | |
| `email_sent_to` | TEXT[] | Endereços para deduplicação |
| `email_last_sent_at` | TIMESTAMPTZ | |

**RLS**: SELECT para `admin` e `financeiro` do tenant; INSERT via serviço
interno; UPDATE (resolver) por `admin`.

### `alert_status_transitions` (append-only)

Trilha de resolução.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `alert_id` | UUID FK → `alerts(id)` | |
| `tenant_id` | UUID NOT NULL | |
| `from_status` | TEXT | |
| `to_status` | TEXT NOT NULL | |
| `actor` | UUID | NULL se auto-resolução |
| `reason` | TEXT | |
| `transitioned_at` | TIMESTAMPTZ DEFAULT now() | |

---

## 9. Audit log

### `audit_log` (append-only, imutável, append-only row-level)

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `tenant_id` | UUID NOT NULL | |
| `actor_id` | UUID | NULL para eventos do sistema (service-role) |
| `actor_label` | TEXT | `user:<email>`, `worker:process-ghl-event`, etc. |
| `timestamp_utc` | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| `entity` | TEXT NOT NULL | Tabela ou entidade lógica |
| `entity_id` | UUID | |
| `field` | TEXT | NULL para criação (INSERT) ou deny |
| `old_value` | TEXT | NULL na criação/deny |
| `new_value` | TEXT | NULL no deny |
| `reason` | TEXT | |
| `ip` | INET | |
| `user_agent` | TEXT | |
| `result` | TEXT NOT NULL DEFAULT 'success' | `success` / `denied` / `conflict` (FR-005b); enforced by `CHECK (result IN ('success','denied','conflict'))` |

**RLS**: SELECT para `admin` do tenant; INSERT apenas via trigger ou
service-role. UPDATE/DELETE absolutamente proibidos (grants + trigger).

**Export**: endpoint `/api/audit/export?format=csv|json` respeita FR-019.

---

## 10. Relationships (ERD textual)

```
tenants 1 ─── * user_tenants * ─── 1 auth.users
tenants 1 ─── 1 tenant_ghl_config
tenants 1 ─── * procedures
tenants 1 ─── * health_plans
tenants 1 ─── * doctors 1 ─── * doctor_commission_history
tenants 1 ─── * patients
tenants 1 ─── * price_versions (self-ref previous_version_id)
tenants 1 ─── * appointments ─── 1 patient, 1 doctor, 1 procedure, 1 plan,
                                  1 price_version, 1 commission_history,
                                  0..1 raw_webhook_event
appointments 1 ─── 0..1 appointment_reversals
tenants 1 ─── * raw_webhook_events 1 ─── * webhook_event_transitions
tenants 1 ─── * alerts 1 ─── * alert_status_transitions
tenants 1 ─── * audit_log

procedures * ─── 1 tuss_codes (lógica, validada em INSERT)
```

---

## 11. State transitions

### Atendimento (via view `appointments_effective`)

```
created (ativo) ──(reversal inserted)──> estornado
                └─ reversion is append-only; "ativo" não retorna depois de "estornado"
```

### Raw webhook event

```
pending ──> processing ──> done
                       └─> dlq ──(admin reprocess)──> processing ──> done
                                                   └─> dlq ...
```

### Alert

```
aberto ──(manual resolve OR auto-resolve)──> resolvido
        └─ "resolvido" não volta para "aberto"; nova ocorrência cria novo alert
```

---

## 12. Indexes (mínimos; expandir conforme telemetria)

- `price_versions(tenant_id, procedure_id, plan_id, valid_from DESC)` —
  resolução de preço vigente (US1, US2).
- `appointments(tenant_id, appointment_at DESC)` — relatório mensal.
- `appointments(tenant_id, doctor_id, appointment_at DESC)` — produção
  por médico.
- `appointments(tenant_id, plan_id, appointment_at DESC)` — receita por
  plano.
- `raw_webhook_events(tenant_id, processing_status, received_at)` — DLQ
  listing.
- `audit_log(tenant_id, timestamp_utc DESC)` — trilha export.
- `alerts(tenant_id, status, created_at DESC)` — dashboard.

---

## 13. RLS policy templates

```sql
-- Tenant isolation (all tenant-scoped tables)
CREATE POLICY tenant_isolation ON <table>
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- Role-gated write (example: price_versions)
CREATE POLICY admin_only_insert_price ON price_versions
  FOR INSERT
  WITH CHECK (
    tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
    AND (auth.jwt() ->> 'role') = 'admin'
  );

-- Patients — admin & financeiro full read; recepcionista partial via view
CREATE POLICY patients_read ON patients
  FOR SELECT
  USING (
    tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
    AND (auth.jwt() ->> 'role') IN ('admin','financeiro','recepcionista','profissional_saude')
  );
```

---

## 14. Validation rules (materializadas como CHECK / triggers)

- `price_versions.amount_cents >= 0`
- `appointment_reversals.reversal_amount_cents < 0`
- `doctor_commission_history.percentage_bps BETWEEN 0 AND 10000`
- `procedures.tuss_code EXISTS IN tuss_codes WHERE valid_to IS NULL` on
  INSERT (trigger-enforced; UPDATE-path not needed porque `procedures` é
  imutável para o campo tuss_code).
- Em `appointments`, trigger de INSERT valida que
  `(tenant_id, procedure_id, plan_id)` tem `price_versions` com
  `valid_from <= appointment_at::date` — senão RAISE → evento vai DLQ.

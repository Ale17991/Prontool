# Data Model — Periograma (Fase 3)

Migration: `0161_perio_chart.sql` (idempotente, aditiva). Padrões reutilizados: RLS por `tenant_id`, `log_audit_event`, triggers de consistência tenant, congelamento espelhando `treatment_budgets` (0160).

## Tabela: `perio_exams` (cabeçalho do exame)

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | UUID PK | `gen_random_uuid()` |
| `tenant_id` | UUID NOT NULL | FK `tenants(id)` ON DELETE RESTRICT |
| `patient_id` | UUID NOT NULL | FK `patients(id)` ON DELETE RESTRICT |
| `appointment_id` | UUID NULL | FK `appointments(id)` ON DELETE SET NULL (vínculo opcional, FR-017) |
| `exam_date` | DATE NOT NULL | default `now()::date` |
| `status` | TEXT NOT NULL | CHECK (`rascunho`,`finalizado`), default `rascunho` |
| `dentition` | TEXT NOT NULL | CHECK (`permanent`,`deciduous`), default `permanent` |
| `notes` | TEXT NULL | length ≤ 2000 |
| `finalized_at` | TIMESTAMPTZ NULL | carimbado na finalização |
| `finalized_by` | UUID NULL | FK `auth.users(id)` ON DELETE SET NULL |
| `created_by` | UUID NULL | FK `auth.users(id)` ON DELETE SET NULL |
| `created_at` | TIMESTAMPTZ NOT NULL | default `now()` |
| `updated_at` | TIMESTAMPTZ NOT NULL | default `now()` |

**Índices**:
- `(tenant_id, patient_id, exam_date DESC)` — listagem.
- UNIQUE parcial `(tenant_id, patient_id) WHERE status = 'rascunho'` — **um rascunho por paciente** (D5/FR-018).

**Ciclo de estado** (trigger `enforce_perio_exam_update`, espelha `treatment_budgets`):
- Núcleo imutável: `id, tenant_id, patient_id, created_by, created_at`.
- Transição válida única: `rascunho → finalizado` (exige `finalized_at` e `finalized_by`). `finalizado` é terminal.
- `updated_at := now()` em qualquer UPDATE.
- DELETE: permitido **apenas** quando `status = 'rascunho'` (descarte de rascunho); bloqueado se finalizado (trigger `enforce_perio_exam_delete`).

## Tabela: `perio_site_measurements` (6 sítios por dente)

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | UUID PK | `gen_random_uuid()` |
| `tenant_id` | UUID NOT NULL | FK `tenants(id)` (herdado do exame, validado em trigger) |
| `exam_id` | UUID NOT NULL | FK `perio_exams(id)` ON DELETE CASCADE |
| `tooth_fdi` | SMALLINT NOT NULL | CHECK faixas FDI (permanente + decíduo, igual `dental_chart_entries`) |
| `site` | TEXT NOT NULL | CHECK (`db`,`b`,`mb`,`dl`,`l`,`ml`) |
| `probing_depth_mm` | SMALLINT NULL | CHECK 0–15 |
| `recession_mm` | SMALLINT NULL | CHECK −5..+15 (sinal: + recessão, − margem coronal) |
| `bleeding` | BOOLEAN NOT NULL | default false |
| `suppuration` | BOOLEAN NOT NULL | default false |
| `plaque` | BOOLEAN NOT NULL | default false |
| `created_at` | TIMESTAMPTZ NOT NULL | default `now()` |
| `updated_at` | TIMESTAMPTZ NOT NULL | default `now()` |

**Derivado (não persistido)**: `cal_mm = probing_depth_mm + recession_mm` (quando ambos presentes).

**Índices/constraints**:
- UNIQUE `(exam_id, tooth_fdi, site)` — alvo do upsert (D6).
- `(exam_id)` — leitura do exame inteiro.

## Tabela: `perio_tooth_findings` (achados por dente)

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | UUID PK | `gen_random_uuid()` |
| `tenant_id` | UUID NOT NULL | FK `tenants(id)` (herdado do exame) |
| `exam_id` | UUID NOT NULL | FK `perio_exams(id)` ON DELETE CASCADE |
| `tooth_fdi` | SMALLINT NOT NULL | CHECK faixas FDI |
| `mobility` | SMALLINT NULL | CHECK 0–3 |
| `furcation` | SMALLINT NULL | CHECK 1–3 (graus I–III) |
| `is_missing` | BOOLEAN NOT NULL | default false |
| `is_implant` | BOOLEAN NOT NULL | default false |
| `created_at` / `updated_at` | TIMESTAMPTZ | default `now()` |

**Constraints**: UNIQUE `(exam_id, tooth_fdi)` — 1 linha por dente/exame (alvo do upsert).

## Triggers comuns (medições + achados)

- **Consistência de tenant** (`check_perio_child`, BEFORE INSERT/UPDATE): valida que `exam_id` existe, pertence a `tenant_id`, e copia/confere o tenant do exame.
- **Congelamento** (`enforce_perio_child_writable`, BEFORE INSERT/UPDATE/DELETE): rejeita escrita se o exame-pai não está em `rascunho` (`USING ERRCODE='42501'`).
- Sem `log_audit_event` por célula (volume); auditoria fica no header (criação + finalização).

## RPC: `perio_exam_indicators(p_tenant_id UUID, p_exam_id UUID)`

`STABLE SECURITY DEFINER`, guarda de tenant (igual `dental_chart_current`). Retorna:
- `sites_measured` INT, `sites_bleeding` INT, `bop_pct` NUMERIC
- `pockets_ge4` INT, `pockets_ge4_pct` NUMERIC
- `cal_avg_mm` NUMERIC
Considera apenas dentes presentes (`perio_tooth_findings.is_missing = false` ou sem achado) e sítios com `probing_depth_mm IS NOT NULL`.

## RLS (as três tabelas)

- SELECT: `tenant_id = jwt_tenant_id()` e papel em (`admin`,`financeiro`,`recepcionista`,`profissional_saude`).
- INSERT/UPDATE/DELETE: `tenant_id = jwt_tenant_id()` e papel em (`admin`,`profissional_saude`). (Escrita só clínica — FR-012.)
- App escreve via service client; a imutabilidade pós-finalização é garantida pelos triggers (que valem inclusive para service_role).

## Auditoria

- `log_audit_event` em `perio_exams` AFTER INSERT (`created`) e AFTER UPDATE quando `status` muda (`finalized`). (FR-014.)

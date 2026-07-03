# Phase 1 — Data Model

Feature: Integração Memed — Prescrição Digital (`026-memed-prescricao-digital`)
Migration: `0108_memed_prescription.sql`

Todas as tabelas: PK UUID, `tenant_id` obrigatório, RLS por `tenant_id`, timestamps UTC. Escritas server-side via `requireRole`; RLS é a segunda camada.

---

## 1. `tenant_memed_config` — conexão Memed por clínica

Uma linha por tenant. Guarda o par de chaves cifrado e o ambiente. Sem conta conectada ⇒ a clínica não oferece prescrição digital.

| Coluna                      | Tipo        | Nulo | Notas                                                                 |
| --------------------------- | ----------- | :--: | --------------------------------------------------------------------- |
| `tenant_id`                 | UUID        | não  | **PK**, FK `tenants(id)` ON DELETE CASCADE                            |
| `environment`               | TEXT        | não  | DEFAULT `'staging'`, CHECK `IN ('staging','production')`              |
| `api_key_enc`               | BYTEA       | não  | cifrado via `enc_text_with_key` (chave `PATIENT_DATA_ENCRYPTION_KEY`) |
| `secret_key_enc`            | BYTEA       | não  | idem                                                                  |
| `connected`                 | BOOLEAN     | não  | DEFAULT `TRUE`; desconectar = `FALSE` (mantém histórico de aceite)    |
| `terms_accepted_at`         | TIMESTAMPTZ | sim  | aceite do termo de responsabilidade (exigido p/ produção, FR-024)     |
| `terms_accepted_by`         | UUID        | sim  | FK `auth.users(id)`                                                   |
| `created_at` / `updated_at` | TIMESTAMPTZ | não  | DEFAULT `now()`; `updated_at` via trigger `touch_updated_at`          |
| `created_by_user_id`        | UUID        | não  | FK `auth.users(id)`                                                   |

- **Invariante**: para `environment='production'` exige `terms_accepted_at IS NOT NULL` (validado no app; SHOULD reforçar por CHECK/trigger).
- **RLS**: SELECT `tenant_id = jwt_tenant_id()`; ALL (write) `... AND jwt_role() = 'admin'`.
- **Segredos nunca saem do servidor**: nenhuma rota retorna `api_key_enc`/`secret_key_enc` nem seus valores decifrados ao browser.

---

## 2. `memed_prescribers` — vínculo profissional ↔ prescritor Memed

1:1 com `doctors` por tenant. Estado de registro + especialidade mapeada.

| Coluna                      | Tipo        | Nulo | Notas                                                            |
| --------------------------- | ----------- | :--: | ---------------------------------------------------------------- |
| `id`                        | UUID        | não  | PK, DEFAULT `gen_random_uuid()`                                  |
| `tenant_id`                 | UUID        | não  | FK `tenants(id)`                                                 |
| `doctor_id`                 | UUID        | não  | FK `doctors(id)` ON DELETE CASCADE                               |
| `external_id`               | UUID        | não  | identificador enviado à Memed (= `doctor_id`, decisão D3)        |
| `status`                    | TEXT        | não  | DEFAULT `'pending'`, CHECK `IN ('pending','registered','error')` |
| `memed_specialty_id`        | TEXT        | sim  | id do catálogo Memed (de-para de especialidade, FR-020/021)      |
| `last_error`                | TEXT        | sim  | última mensagem de erro de sincronização (mascarada)             |
| `last_synced_at`            | TIMESTAMPTZ | sim  | última sincronização bem-sucedida com a Memed                    |
| `created_at` / `updated_at` | TIMESTAMPTZ | não  | `updated_at` via trigger                                         |
| `created_by_user_id`        | UUID        | não  | FK `auth.users(id)`                                              |

- **UNIQUE** `(tenant_id, doctor_id)`.
- **Transições de `status`**: `pending` → `registered` (sucesso no `POST/GET /usuarios`) | `pending|registered` → `error` (falha) | `error` → `registered` (retry ok).
- **RLS**: SELECT `tenant_id = jwt_tenant_id()` (qualquer papel autenticado do tenant — para a UI saber se o profissional está apto); INSERT/UPDATE `... AND jwt_role() = 'admin'`.

---

## 3. `prescription_records` — registro auditável de prescrições

Uma linha por prescrição **emitida**. Append-only: exclusão marca `deleted_at` por caminho guardado, nunca apaga.

| Coluna                  | Tipo        | Nulo | Notas                                                                                     |
| ----------------------- | ----------- | :--: | ----------------------------------------------------------------------------------------- |
| `id`                    | UUID        | não  | PK, DEFAULT `gen_random_uuid()`                                                           |
| `tenant_id`             | UUID        | não  | FK `tenants(id)`                                                                          |
| `appointment_id`        | UUID        | sim  | FK `appointments(id)` — vínculo ao atendimento (nullable: prescrição fora de atendimento) |
| `patient_id`            | UUID        | não  | FK `patients(id)`                                                                         |
| `doctor_id`             | UUID        | não  | FK `doctors(id)`                                                                          |
| `memed_prescription_id` | TEXT        | não  | id da prescrição na Memed (do evento `prescricaoImpressa`)                                |
| `status`                | TEXT        | não  | DEFAULT `'issued'`, CHECK `IN ('issued','deleted')`                                       |
| `issued_at`             | TIMESTAMPTZ | não  | DEFAULT `now()`                                                                           |
| `deleted_at`            | TIMESTAMPTZ | sim  | preenchido na transição para `'deleted'`                                                  |
| `created_at`            | TIMESTAMPTZ | não  | DEFAULT `now()`                                                                           |
| `created_by_user_id`    | UUID        | não  | FK `auth.users(id)` (profissional que emitiu)                                             |

- **UNIQUE** `(tenant_id, memed_prescription_id)` (idempotência do registro de emissão).
- **NÃO armazena conteúdo clínico** (medicamentos/posologia) — só metadados de rastreabilidade (FR-019, LGPD/minimização).
- **Imutabilidade (Princípios I/II)** via triggers:
  - `BEFORE DELETE` → `RAISE EXCEPTION` (proibido apagar).
  - `BEFORE UPDATE` → permitir **somente** a transição `status 'issued' → 'deleted'` com `deleted_at` sendo definido (de NULL para timestamp); qualquer outra mudança de coluna `RAISE EXCEPTION`. Padrão dos triggers de imutabilidade já usados (ex. `appointment_completions`, migration 0092).
- **RLS**: SELECT `tenant_id = jwt_tenant_id()` (papéis `admin`, `financeiro`, `recepcionista`, `profissional_saude` do tenant — para o prontuário/atendimento indicar prescrições); INSERT/UPDATE restritos a `profissional_saude`/`admin` do tenant via `requireRole` no app + policy (`jwt_role() IN ('admin','profissional_saude')`).

---

## Auditoria (transversal)

Ações registram `log_audit_event` com `ator`, `timestamp UTC`, `tenant_id`, `entidade`, `origem` (IP/UA):

- `memed.connect` / `memed.disconnect` (admin)
- `memed.prescriber.enable` (admin) — doctor_id, status resultante
- `prescription.issued` — appointment_id, patient_id, doctor_id, memed_prescription_id
- `prescription.deleted` — memed_prescription_id

## Test helper

Acrescentar as 3 tabelas a `test_truncate_all_mutable()` (migration 0040 define a função) para os testes terem slate limpo.

## Relação com dados existentes (não recriar)

- `doctors`: `full_name`, `cpf`, `council_name`, `council_number`, `council_state`, `birth_date` (0107), `specialty`, `email`?/`telefone`? (não existem em doctors — opcionais na Memed; enviar quando disponíveis).
- `patients`: campos `_enc` decifrados via RPC `get_patient_for_tenant` para o `setPaciente`.

# Phase 1 — Data Model: Faturamento TISS

Migration: **`0112_tiss_faturamento.sql`**. Todas as tabelas: `tenant_id UUID NOT NULL`, PK UUID, RLS por `jwt_tenant_id()`, append-only via `enforce_append_only_columns(<whitelist>)`, mutações logam `log_audit_event`. Valores monetários em **centavos (BIGINT)**. Timestamps **UTC**. Segredos cifrados via `enc_text_with_key`.

## Entidades

### 1. `tenant_tiss_operator_config` (config TISS por operadora)

1:1 com `health_plans` (um convênio habilita TISS). Append-only nos campos de identidade; `active` e mapeamentos atualizáveis por whitelist.

| Coluna                  | Tipo                 | Regra                                                    |
| ----------------------- | -------------------- | -------------------------------------------------------- |
| `id`                    | UUID PK              |                                                          |
| `tenant_id`             | UUID FK tenants      | RLS                                                      |
| `health_plan_id`        | UUID FK health_plans | UNIQUE(tenant_id, health_plan_id)                        |
| `ans_registration`      | TEXT                 | Registro ANS da operadora (6 díg.); obrigatório          |
| `tiss_version`          | TEXT                 | default `'04.03.00'`; versão adotada pela operadora      |
| `contracted_code`       | TEXT                 | código do prestador/contratado na operadora; obrigatório |
| `contracted_cnpj`       | TEXT                 | CNPJ do contratado; obrigatório                          |
| `contracted_cnes`       | TEXT                 | CNES; `'9999999'` se não houver                          |
| `procedure_table_map`   | JSONB                | mapeamentos de tabela própria↔TUSS por operadora         |
| `active`                | BOOLEAN              | default true                                             |
| `created_at/created_by` |                      |                                                          |

### 2. `tenant_tiss_certificates` (certificado ICP-Brasil A1)

Por tenant (pode haver mais de um; um `active`). **Segredo** — `.pfx` e senha cifrados.

| Coluna                  | Tipo        | Regra                                                      |
| ----------------------- | ----------- | ---------------------------------------------------------- |
| `id`                    | UUID PK     |                                                            |
| `tenant_id`             | UUID FK     | RLS; admin-only                                            |
| `pfx_enc`               | BYTEA       | `.pfx`/`.p12` cifrado (`enc_text_with_key` sobre base64)   |
| `password_enc`          | BYTEA       | senha do certificado, cifrada                              |
| `subject_cn`            | TEXT        | CN do titular (para exibição)                              |
| `not_after`             | TIMESTAMPTZ | validade — alerta de expiração                             |
| `active`                | BOOLEAN     | só 1 ativo por tenant (índice parcial UNIQUE WHERE active) |
| `created_at/created_by` |             |                                                            |

### 3. `tiss_guias` (guia gerada)

Append-only; valor congelado; status por whitelist.

| Coluna                     | Tipo                                                                       | Regra                                                       |
| -------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `id`                       | UUID PK                                                                    |                                                             |
| `tenant_id`                | UUID FK                                                                    | RLS                                                         |
| `health_plan_id`           | UUID FK                                                                    | operadora                                                   |
| `appointment_id`           | UUID FK appointments                                                       | origem                                                      |
| `guia_type`                | TEXT CHECK in ('consulta','sp_sadt')                                       |                                                             |
| `guia_number_prestador`    | TEXT                                                                       | nº da guia no prestador (sequencial por tenant)             |
| `beneficiary_snapshot_enc` | BYTEA                                                                      | snapshot cifrado do beneficiário (nome/carteira) no momento |
| `executante_snapshot`      | JSONB                                                                      | conselho/nº/UF/CBO/nome do executante (não-PII)             |
| `frozen_amount_cents`      | BIGINT                                                                     | congelado de `appointments_effective.net_amount_cents`      |
| `tiss_version`             | TEXT                                                                       | versão usada (`04.03.00`)                                   |
| `tuss_catalog_version_id`  | UUID FK tuss_catalog_versions                                              | rastreabilidade do catálogo                                 |
| `status`                   | TEXT CHECK in ('rascunho','pronta','exportada','paga','glosada','parcial') | whitelist update                                            |
| `validation_errors`        | JSONB                                                                      | pendências da última validação (vazio = ok)                 |
| `lote_id`                  | UUID FK tiss_lotes NULL                                                    | preenchido ao lotear                                        |
| `supersedes_guia_id`       | UUID FK tiss_guias NULL                                                    | reapresentação (vínculo à original)                         |
| `exported_at`              | TIMESTAMPTZ NULL                                                           | whitelist                                                   |
| `created_at/created_by`    |                                                                            |                                                             |

**Whitelist update**: `status`, `validation_errors`, `lote_id`, `exported_at`. Demais imutáveis.

### 4. `tiss_guia_procedures` (linhas de procedimento da guia)

Append-only.

| Coluna                  | Tipo                    | Regra                                               |
| ----------------------- | ----------------------- | --------------------------------------------------- |
| `id`                    | UUID PK                 |                                                     |
| `tenant_id` / `guia_id` | UUID FK                 | RLS / pai                                           |
| `sequence`              | INT                     | UNIQUE(guia_id, sequence)                           |
| `tuss_table`            | TEXT                    | domínio 87 (ex.: '22','18','20','00') — obrigatório |
| `procedure_code`        | TEXT                    | código; obrigatório (par com tuss_table)            |
| `description`           | TEXT                    |                                                     |
| `quantity`              | INT                     | ≥1                                                  |
| `via`                   | TEXT NULL               | via de acesso (SP/SADT cirúrgico)                   |
| `tecnica`               | TEXT NULL               | domínio 48 (SP/SADT)                                |
| `unit_amount_cents`     | BIGINT                  |                                                     |
| `total_amount_cents`    | BIGINT                  | qty × unit (± redução/acréscimo)                    |
| `tuss_code_id`          | UUID FK tuss_codes NULL | vínculo ao catálogo (valida `valid_to`)             |

### 5. `tiss_lotes` (lote de guias)

Append-only; status/arquivo por whitelist.

| Coluna                         | Tipo                                           | Regra                                                                   |
| ------------------------------ | ---------------------------------------------- | ----------------------------------------------------------------------- |
| `id`                           | UUID PK                                        |                                                                         |
| `tenant_id` / `health_plan_id` | UUID FK                                        | RLS; lote de UMA operadora                                              |
| `lote_number`                  | TEXT                                           | sequencial por tenant×operadora; UNIQUE                                 |
| `tiss_version`                 | TEXT                                           | `04.03.00`                                                              |
| `status`                       | TEXT CHECK in ('aberto','fechado','exportado') | whitelist                                                               |
| `xml_content`                  | TEXT NULL                                      | XML assinado persistido (reprodutibilidade — mesmo hash no re-download) |
| `xml_hash_md5`                 | TEXT NULL                                      | hash do epílogo                                                         |
| `signed_at`                    | TIMESTAMPTZ NULL                               |                                                                         |
| `certificate_id`               | UUID FK tenant_tiss_certificates NULL          | qual cert assinou                                                       |
| `exported_at`                  | TIMESTAMPTZ NULL                               |                                                                         |
| `created_at/created_by`        |                                                |                                                                         |

### 6. `tiss_glosas` (recusa registrada manualmente)

Append-only (correção = nova linha).

| Coluna                  | Tipo         | Regra                                         |
| ----------------------- | ------------ | --------------------------------------------- |
| `id`                    | UUID PK      |                                               |
| `tenant_id` / `guia_id` | UUID FK      | RLS / guia glosada                            |
| `guia_procedure_id`     | UUID FK NULL | linha específica (ou guia inteira)            |
| `motivo_code`           | TEXT         | código Tabela 38 (inclui 9901-9999 operadora) |
| `motivo_text`           | TEXT         | descrição do motivo                           |
| `glosado_amount_cents`  | BIGINT       | valor glosado                                 |
| `created_at/created_by` |              |                                               |

### 7. `tiss_domain_tables` (catálogo de domínios TISS)

Seed read-only (como `tuss_codes`). Domínios necessários: 38, 87, 26, 24, 59, 52, 36, 48, 50, 23, 76, 35.

| Coluna                | Tipo    | Regra                     |
| --------------------- | ------- | ------------------------- |
| `id`                  | UUID PK |                           |
| `domain_number`       | TEXT    | ex.: '38','87'            |
| `code`                | TEXT    | valor                     |
| `description`         | TEXT    |                           |
| `valid_from/valid_to` | DATE    | versionamento (como TUSS) |

> **Sem `tenant_id`** — domínio é dado oficial global (read-only, RLS de leitura para autenticados). Append-only via `enforce_append_only`.

## Captura de gaps (R8) — sub-tarefas de schema

- **`patient_health_plan_cards`** (nova): `tenant_id, patient_id, health_plan_id, card_number_enc, card_valid_until, UNIQUE(tenant_id, patient_id, health_plan_id)`. Carteira do beneficiário por operadora (cifrada).
- **`doctors.cbo`** (ALTER add, TEXT NULL): CBO do profissional (dom. 24).
- **CNES**: em `tenant_tiss_operator_config.contracted_cnes` (já acima).

## Máquina de status da guia

```
rascunho → (validação OK) → pronta → (loteada+exportada) → exportada
exportada → paga | glosada | parcial
glosada/parcial → (reapresentação: nova guia com supersedes_guia_id) → rascunho(nova)
```

Transições só por caminho de aplicação guardado por trigger whitelist. Nunca DELETE.

## RLS (resumo)

- Leitura: `tenant_id = jwt_tenant_id()` em todas (domínios: `true` para autenticado).
- Escrita config/certificado: `jwt_role() = 'admin'`.
- Escrita guia/lote/glosa: `jwt_role() IN ('admin','financeiro')`.
- `service_role` bypass para jobs/seed.

## Triggers

- `enforce_append_only_columns('<whitelist>')` em todas as tabelas mutáveis (whitelists acima).
- `enforce_append_only()` em `tiss_domain_tables`.
- Validação de coerência (BEFORE INSERT) na linha de procedimento: par `tuss_table`+`procedure_code` presente; se `tuss_code_id` setado, `tuss_codes.valid_to` nulo ou futuro (senão sinaliza — Princípio IV).
- `log_audit_event` AFTER em config, certificado, guia, lote, glosa.

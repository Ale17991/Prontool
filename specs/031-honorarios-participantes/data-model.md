# Phase 1 — Data Model: Honorários e participantes por procedimento

## Entidade: Participação em procedimento (estende `appointment_assistants`)

Tabela existente `public.appointment_assistants` (migration 0084), **estendida** pela migration 0128.

### Colunas (existentes mantidas)

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | gen_random_uuid() |
| `tenant_id` | UUID NOT NULL | FK tenants; RLS |
| `appointment_id` | UUID NOT NULL | FK appointments |
| `assistant_doctor_id` | UUID NOT NULL | FK doctors — o **participante** |
| `frozen_amount_cents` | BIGINT NOT NULL | **honorário** congelado (>0, <100000000) |
| `created_by` / `created_at` | UUID / TIMESTAMPTZ | |
| `removed_at` / `removed_by` | TIMESTAMPTZ / UUID | soft-unlink (par completo) |

### Colunas novas (0128)

| Coluna | Tipo | Notas |
|---|---|---|
| `procedure_id` | UUID NULL | FK `appointment_procedures(id)` — linha de procedimento. NULL = participação a nível de atendimento (legado). |
| `participation_degree` | TEXT NULL | Código do grau (domínio TISS 35). Validado por pertinência ao domínio na camada de aplicação. |

### Regras / constraints

- **Append-only**: `enforce_appointment_assistants_mutation` (0084) mantido — só `removed_at`/`removed_by` mudam (NULL→NOT NULL); demais colunas imutáveis. `procedure_id` e `participation_degree` são imutáveis após INSERT (acrescentar à checagem do trigger).
- **Tenant consistency**: `check_assistant_tenant_consistency` (0084) estendido para validar que `procedure_id` (quando presente) pertence ao mesmo `appointment_id`/`tenant_id`.
- **Modalidade**: trigger liberal-only (trigger 3 da 0084) **substituído** — exige apenas que `assistant_doctor_id` seja um médico **ativo** do tenant (qualquer `payment_mode`).
- **Unicidade**: índice parcial novo `UNIQUE (appointment_id, procedure_id, assistant_doctor_id) WHERE removed_at IS NULL` (substitui o `(appointment_id, assistant_doctor_id)`), permitindo o mesmo médico em procedimentos distintos.
- **Honorário**: `frozen_amount_cents > 0` (CHECK existente).
- **RLS**: SELECT por `tenant_id = jwt_tenant_id()` (existente). INSERT/UPDATE só via RPC SECURITY DEFINER / service role (padrão 0084).

### Transições de estado

`ativo` (removed_at IS NULL) → `removido` (removed_at/removed_by set). Sem volta. Correção = novo INSERT.

## Entidade: Grau de participação (catálogo — somente leitura)

`public.tiss_domain_tables` domínio `'35'` (já semeado). `{ code, description, valid_to }`. Usado para popular o seletor e validar `participation_degree`.

## Relacionamentos

```
appointments 1───* appointment_assistants *───1 doctors (participante)
appointment_procedures 1───* appointment_assistants   (via procedure_id, novo)
tiss_domain_tables(35) ·····  participation_degree     (validação por código)
```

## Impacto em consumidores existentes

- **Repasse** (`monthly-payouts/index.ts` + RPC `close_monthly_payout` 0126): já agregam `appointment_assistants` por médico; passam a incluir qualquer modalidade automaticamente (sem mudança de query). Rótulo "liberal" → "participações" só na apresentação.
- **TISS SP/SADT** (`build-guia.ts` / `render-spsadt.ts`): novo bloco `equipeSadt` por linha, montado a partir das participações com `procedure_id` daquela linha.
- **UI do atendimento**: a edição de participantes passa a ser **por procedimento** (hoje é por atendimento via `assistant-multi-select`), com seletor de grau e honorário.

## Validações (camada de aplicação)

| Campo | Regra |
|---|---|
| `assistant_doctor_id` | médico ativo do tenant; ≠ duplicado ativo na mesma (appointment, procedure) |
| `procedure_id` | pertence ao appointment/tenant (quando informado) |
| `participation_degree` | pertence ao domínio 35 (ou faixa própria, se aplicável); rejeita texto livre |
| `frozen_amount_cents` | inteiro > 0 |
| guia SP/SADT | participante precisa de CPF + conselho + UF + CBO completos para a guia ficar `pronta` |

# Phase 1 — Data Model: Painel /admin

## Entidade nova: `plan_prices` (global — config de plataforma)

| Coluna        | Tipo                               | Notas                                                 |
| ------------- | ---------------------------------- | ----------------------------------------------------- |
| `plan`        | TEXT PK                            | `essencial` \| `pro` \| `clinica` \| `legacy` (CHECK) |
| `price_cents` | INTEGER NOT NULL DEFAULT 0         | preço mensal em centavos (BRL)                        |
| `updated_at`  | TIMESTAMPTZ NOT NULL DEFAULT now() | touch trigger                                         |
| `updated_by`  | UUID NULL                          | super-admin que editou                                |

- **Sem `tenant_id`** — é config global da plataforma (mensalidade por plano).
- **Seed**: 1 linha por plano com `price_cents=0` (editar no /admin depois).
- **RLS**: leitura/escrita só via service client (super-admin); sem policy para authenticated (não é dado de clínica).
- **Mutável** (config); trilha em `audit_log` ao editar.

## Agregações derivadas (sem persistência — calculadas por request)

### Resumo financeiro (US1)

- `mrrPorPlano[P] = countAtivas(P) × plan_prices[P].price_cents`; `mrrTotal = Σ`.
- `countPorStatus = { trial, active, past_due, canceled }` (de `tenant_entitlements.status`).
- `trialsAVencer = entitlements(status='trial', trial_ends_at ≤ hoje+N)`.
- `inadimplentes = entitlements(status='past_due')`.
- `churn = entitlements(status='canceled', updated_at no período)`.

### Uso por clínica (US2)

- `atendimentosPeriodo`, `usuariosAtivos`, `ultimaAtividade`, `emRisco = ultimaAtividade < hoje-14d`.

### Feed de auditoria (US3)

- Linhas de `audit_log` (ator, tenant, entity/field, old/new, reason, created_at) filtradas por tipo (mapa entity/field do research R4), tenant, ator, período; paginadas.

### Saúde do sistema (US4)

- Listas/contagens de `alerts` (abertos), `integration_sync_log` (falhas), DLQ (pendentes), `appointment_reminders` (último ciclo/falhas), crons.

## Entidades existentes lidas (read-only, cross-tenant via service client)

`tenant_entitlements`, `tenants`, `user_tenants`, `appointments`, `audit_log`, `alerts`, `integration_sync_log`, `appointment_reminders`.

## Estado / transições

- `plan_prices`: `[preço atual] --(adminSetPlanPriceAction, super-admin, auditado)--> [novo preço]`. MRR usa sempre o valor vigente.
- Nenhuma outra escrita — os 4 painéis são leitura.

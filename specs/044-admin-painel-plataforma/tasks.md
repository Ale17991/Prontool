---
description: 'Task list — Painel /admin (financeiro, uso, auditoria, sistema)'
---

# Tasks: Painel /admin — financeiro, uso, auditoria e saúde do sistema

**Input**: Design docs em `/specs/044-admin-painel-plataforma/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/admin-panels.md

**Tests**: Incluídos para a lógica de cálculo (MRR, risco, mapeamento do feed). ⚠️ Rodar testes apaga o banco local — re-seedar com `pnpm seed:demo`.

**Organization**: Tarefas por user story (P1→P3). US1 é o MVP.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: paralelizável (arquivos diferentes, sem dependência pendente)
- **[Story]**: US1=Financeiro, US2=Uso, US3=Auditoria, US4=Sistema

---

## Phase 1: Setup

- [x] T001 Sanity: confirmar `0165` como próximo número de migração, que `recharts`/`date-fns` já estão no projeto (sem novas deps), e que o layout do `/admin` já restringe a super-admin (server-side). Revisar `contracts/admin-panels.md`.

---

## Phase 2: Foundational (Blocking Prerequisites)

- [x] T002 Criar `supabase/migrations/0165_plan_prices.sql`: tabela `plan_prices (plan PK CHECK essencial|pro|clinica|legacy, price_cents INT NOT NULL DEFAULT 0, updated_at, updated_by)`, touch trigger, RLS (só service role; sem policy authenticated), seed de 1 linha por plano com `price_cents=0`.
- [ ] T003 `pnpm supabase:reset` + `pnpm supabase:gen-types` para os tipos da nova tabela. (Se o stack local não estiver de pé, usar cast `as never` no acesso, padrão do projeto, e rodar gen-types depois.)

**Checkpoint**: tabela de preços pronta; painéis podem ser construídos.

---

## Phase 3: User Story 1 - Financeiro / MRR (Priority: P1) 🎯 MVP

**Goal**: Super-admin vê MRR total/por plano, status de cobrança, trials a vencer, inadimplentes e churn; edita os preços de plano.

**Independent Test**: definir preços → MRR por plano = clínicas ativas × preço; total = soma; editar preço recalcula e audita.

- [x] T004 [US1] `src/lib/core/admin/plan-prices.ts` (novo): `getPlanPrices(sb)` (Record<Plan, cents>, 0 default) e `setPlanPrice(sb, actorId, plan, priceCents)` (valida ≥0 inteiro, upsert, audita em `audit_log`).
- [x] T005 [US1] `src/lib/core/admin/financial-summary.ts` (novo): `getFinancialSummary(sb, {periodFrom, periodTo, trialWindowDays})` → MRR total/por plano (clínicas `status='active'` × preço; legado incluso), contagem por status, trials a vencer (`status='trial'`, `trial_ends_at ≤ hoje+N`), inadimplentes (`past_due`), churn (`canceled` no período).
- [x] T006 [US1] `src/app/admin/financeiro/actions.ts` (novo): `adminSetPlanPriceAction(plan, priceCents)` — super-admin (`superAdminUserId`), chama `setPlanPrice`, `revalidatePath('/admin','layout')`.
- [x] T007 [US1] `src/app/admin/financeiro/page.tsx` (novo): cards de MRR total/por plano + status + listas (trials/inadimplentes/churn); cada bloco degrada isolado (try/catch → "indisponível").
- [x] T008 [US1] `src/app/admin/financeiro/plan-prices-form.tsx` (novo, client): editar preço por plano via `adminSetPlanPriceAction` (em reais → centavos), feedback.
- [x] T009 [US1] `src/app/admin/admin-nav.tsx`: adicionar item "Financeiro" → `/admin/financeiro`.
- [x] T010 [P] [US1] Teste unit `tests/unit/admin-financial.spec.ts`: MRR (plano×preço, legado incluso, trial/cancelado fora do MRR ativo); contagem por status.

**Checkpoint**: US1 funcional e testável (MVP).

---

## Phase 4: User Story 2 - Uso & risco das clínicas (Priority: P2)

**Goal**: Por clínica: atendimentos, usuários ativos, última atividade; destaque de risco (>14d inativa); ordenável.

**Independent Test**: clínica sem atividade há >14 dias aparece "em risco"; ativa não.

- [ ] T011 [US2] `src/lib/core/admin/clinic-usage.ts` (novo): `getClinicUsage(sb, {periodFrom, periodTo, riskDays=14})` → por tenant: atendimentos no período (`count`), usuários ativos (`user_tenants status='active'`), última atividade (max de `appointments.appointment_at`/`audit_log.created_at`), `atRisk`.
- [ ] T012 [US2] `src/app/admin/uso/page.tsx` (novo): tabela ordenável por uso/risco + sinal visual de risco; degradação por card.
- [ ] T013 [US2] `src/app/admin/admin-nav.tsx`: adicionar item "Uso & risco" → `/admin/uso`.
- [ ] T014 [P] [US2] Teste unit `tests/unit/admin-clinic-usage.spec.ts`: flag `atRisk` por limiar de dias.

**Checkpoint**: US2 independente; US1 intacta.

---

## Phase 5: User Story 3 - Auditoria global (Priority: P2)

**Goal**: Feed cross-tenant de ações sensíveis com filtros (tipo/clínica/ator/período), paginado.

**Independent Test**: impersonar + mudar plano → ambos aparecem; filtrar por tipo reduz a lista.

- [ ] T015 [US3] `src/lib/core/admin/audit-feed.ts` (novo): `getAuditFeed(sb, {type?, tenantId?, actorId?, from?, to?, page, pageSize})` lendo `audit_log` com o mapa tipo→(entity,field) do research R4; default período 30 dias; paginado.
- [ ] T016 [US3] Fechar gaps de auditoria (research R6): garantir que **mudança de plano/módulo** (`setTenantPlanAction`/`set_tenant_entitlement`) e **reset de senha** (`adminResetPasswordAction`/`adminSendResetEmailAction`) gravem `audit_log`; adicionar o insert mínimo onde faltar.
- [ ] T017 [US3] `src/app/admin/auditoria/page.tsx` (novo): feed cronológico (ator/clínica/antes-depois/horário) + filtros (tipo/clínica/ator/período) + paginação.
- [ ] T018 [US3] `src/app/admin/admin-nav.tsx`: adicionar item "Auditoria" → `/admin/auditoria`.
- [ ] T019 [P] [US3] Teste unit `tests/unit/admin-audit-feed.spec.ts`: mapeamento tipo→entity/field (ex.: "impersonação" → entity session + fields impersonation\_\*).

**Checkpoint**: US3 independente.

---

## Phase 6: User Story 4 - Saúde do sistema (Priority: P3)

**Goal**: Painel "o que está quebrado agora": alertas, integrações falhando, DLQ, lembretes/crons.

**Independent Test**: com um alerta aberto + uma integração falhando, ambos aparecem; resolver → some.

- [ ] T020 [US4] `src/lib/core/admin/system-health.ts` (novo): `getSystemHealth(sb)` → alertas abertos (`alerts`), falhas de integração (`integration_sync_log`), contagem DLQ (reusar a query de `/api/alertas/dlq`), status de lembretes (`appointment_reminders` último ciclo/falhas) e crons.
- [ ] T021 [US4] `src/app/admin/sistema/page.tsx` (novo): blocos por fonte, cada um degradando isolado.
- [ ] T022 [US4] `src/app/admin/admin-nav.tsx`: adicionar item "Sistema" → `/admin/sistema`.

**Checkpoint**: US4 independente.

---

## Phase 7: Polish & Cross-Cutting

- [ ] T023 [P] Verificar gating: as 4 páginas só abrem para super-admin (reusa guarda do layout /admin) — confirmar fail-closed para não-super.
- [ ] T024 Rodar `pnpm typecheck`, `pnpm lint`, `pnpm lint:auth` e build de produção; validar os cenários do `quickstart.md`.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (1)** → **Foundational (2)** (migração `0165` + tipos) bloqueia US1 (preços). US2/US3/US4 dependem só do Foundational (leem dados existentes).
- **US1 (3)** = MVP.
- **US2/US3/US4 (4–6)** independentes entre si.

### Acoplamento (sequenciar)

- `src/app/admin/admin-nav.tsx`: T009 (US1), T013 (US2), T018 (US3), T022 (US4) — mesmo arquivo, sequenciar.

### Paralelizável

- Foundational: T002 antes de T003.
- Os cores de agregação (T005, T011, T015, T020) são arquivos distintos → paralelizáveis entre si após o Foundational. Testes (T010/T014/T019) idem.

---

## Implementation Strategy

### MVP (US1 — Financeiro/MRR)

1. Setup + Foundational (tabela de preços).
2. US1: preços + MRR + status/trials/inadimplentes/churn.
3. **STOP & VALIDATE** (Cenário A). Deploy/demo.

### Incremental

US1 → US2 (uso/risco) → US3 (auditoria + fechar gaps) → US4 (sistema) → Polish.

---

## Notes

- Tudo super-admin server-side; leitura cross-tenant via service client (padrão /admin).
- `plan_prices` é a única escrita (auditada). Valores em centavos (BRL).
- Cada card degrada isolado (FR-003) — painel nunca derruba a página.
- ⚠️ `vitest run` apaga o banco local; re-seedar com `pnpm seed:demo`.

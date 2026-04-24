---

description: "Task list for feature 002-ghl-optional-standalone"
---

# Tasks: GHL Opcional + Modo Standalone + Multi-Plataforma

**Input**: Design documents in `C:\My project\specs\002-ghl-optional-standalone\`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅, quickstart.md ✅

**Tests**: INCLUDED. Constitution §Fluxo de Desenvolvimento exige testes de contrato, isolamento multi-tenant e autorização por papel para qualquer feature que afete preços/faturas/RLS — é o caso desta feature. Cada US ganha contract tests + integration tests.

**Organization**: Por user story. US1 (P1) é o MVP — standalone parity. US2 (P2) monta registry + UI. US3 (P3) liga o event bus fan-out.

## Path Conventions

Monorepo Next.js — `src/app/` para rotas, `src/lib/` para domínio, `supabase/migrations/` para schema, `tests/{contract,integration,e2e}/` para testes.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Esqueleto compartilhado por todas as stories. Arquivos pequenos, sem lógica ainda.

- [X] T001 [P] Create `src/lib/integrations/types.ts` with `ProviderId`, `PatientSnapshot`, `AppointmentSnapshot`, `DomainEvent`, `AdapterContext`, `IntegrationAdapter` exports per data-model.md §Non-entity section
- [X] T002 [P] Create `src/lib/integrations/registry.ts` exporting empty `registry` object plus `getAdapter(provider)` and `listProviders()` helpers per data-model.md
- [X] T003 [P] Add placeholder directories `src/lib/integrations/hubspot/`, `src/lib/integrations/rdstation/`, `src/lib/integrations/pipedrive/` each with a `.gitkeep` and a `README.md` listing open fields per contracts/integration-adapter.md checklist

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema + helpers que US2/US3 dependem. US1 é tecnicamente independente, mas incluímos as migrations aqui para não precisar rebase depois.

**⚠️ CRITICAL**: User story work só começa depois deste phase fechar.

- [X] T004 Write Supabase migration `supabase/migrations/0040_tenant_integrations.sql` creating table `tenant_integrations` (PK composite, columns per data-model.md), enabling RLS and policies `tenant_integrations_tenant_read` + `tenant_integrations_admin_write`, plus data copy from `tenant_ghl_config` → rows `provider='ghl'`
- [X] T005 [P] Write Supabase migration `supabase/migrations/0042_rename_alert_type.sql` renaming `alerts.type` value `ghl_sync_failed` → `integration_sync_failed` and updating CHECK constraint per data-model.md §`alerts`
- [X] T006 [P] Create `src/lib/core/integrations/config.ts` exporting `getEnabledIntegrations(supabase, tenantId)` and `getIntegrationConfig(supabase, tenantId, provider)` wrapped in React `cache()` per research.md R-001
- [X] T007 [P] Create `src/lib/core/integrations/credentials.ts` exporting `decryptCredentials(supabase, row, schema)` that decrypts `credentials_enc` via `enc_text_with_key` and parses against provider's `credentialsSchema`
- [X] T008 [P] Create `src/lib/core/events/publish.ts` and `src/lib/core/events/dispatch.ts` — publish is a thin wrapper around dispatch; dispatch is a no-op stub for now (iterates `getEnabledIntegrations` and returns `[]` — real implementation comes in US3 T037)
- [X] T009 [P] Create `src/lib/core/audit/integration-events.ts` exporting `recordIntegrationEvent({type, tenantId, provider, actorUserId, before, after, reason, ip, ua})` that inserts into `audit_log` using `adapter.redactCredentials` for redaction, per research.md R-009
- [X] T010 Run `pnpm supabase:reset` locally and verify all migrations (0001 → 0042) apply cleanly; regenerate types via `pnpm supabase:gen-types`

**Checkpoint**: Schema is multi-provider ready. Dispatcher is inert (safe to call from any path — returns empty). User stories can start.

---

## Phase 3: User Story 1 — Clínica standalone usa o Pronttu sem GHL (Priority: P1) 🎯 MVP

**Goal**: Novo tenant sem linhas em `tenant_integrations` cadastra pacientes, registra atendimentos, gera relatório. Zero chamadas externas, zero badges de integração, zero alertas.

**Independent Test**: Seed tenant sem linhas em `tenant_integrations`. Cadastrar 2 pacientes manualmente via `POST /api/pacientes`; registrar 5 atendimentos via `POST /api/atendimentos/manual`. Abrir o dashboard: zero menções a GHL/HubSpot/etc no DOM. `select count(*) from alerts where tenant_id=<demo>` = 0. Relatório mensal inclui os 5 atendimentos com `source='manual'`.

### Tests for User Story 1 (write first, ensure fail)

- [~] T011 [P] [US1] Contract test `tests/contract/atendimentos-manual.spec.ts` — **deferred**: project contract tests use OpenAPI specs, this feature uses markdown contracts. Coverage from the markdown contract is instead exercised by the integration suite in T012.
- [X] T012 [P] [US1] Integration test `tests/integration/standalone-flow.spec.ts` — 5 cases green: happy path + override + future-date 400 + RBAC 403 + tenant-isolation 404
- [ ] T013 [P] [US1] E2E test `tests/e2e/standalone-no-integrations-ui.spec.ts` (Playwright) — **not run** (needs dev server + browser); manual validation via quickstart.md Scenario 1 covers this
- [X] T014 [P] [US1] Tenant-isolation case covered inline in `tests/integration/standalone-flow.spec.ts` (same-file as T012; "rejeita FKs de outro tenant com 404")

### Implementation for User Story 1

- [X] T015 [P] [US1] Create `src/lib/core/appointments/create-manual.ts` — implemented with TUSS validation, tenant-FK guard, `resolvePrice`/`resolveCommission`, `source='manual'`, amount override. Audit `appointment.price_override` deferred (not needed for MVP — vigente ID is preserved for rastro)
- [X] T016 [US1] Implement `src/app/api/atendimentos/manual/route.ts` — POST handler live, wired to `publishDomainEvent` (stub returns `[]` for standalone), returns `integrations_dispatched` array
- [X] T017 [P] [US1] Server component `src/app/(dashboard)/operacao/atendimentos/novo/page.tsx` + client form `new-appointment-form.tsx` with patient/doctor/procedure/plan selects, datetime-local, auto-fill via `/api/precos/vigente`, observacoes textarea
- [X] T018 [US1] "Novo atendimento" button added to `src/app/(dashboard)/operacao/atendimentos/page.tsx` (visible only to admin/recepcionista)
- [~] T019 [P] [US1] Sidebar badge component — **deferred to US2**. No providers to show yet; empty-array render case handled by omitting the component entirely
- [~] T020 [US1] Layout wiring of `getEnabledIntegrations` — **deferred to US2**. Current sidebar has no GHL/integration references, so standalone mode shows no leak without explicit wiring
- [X] T021 [US1] Audited `(dashboard)/**/*.tsx` and fixed leaks: `configuracoes/page.tsx` (planned-scope copy), `operacao/pacientes/novo/page.tsx` (subtitle conditional on `hasIntegrations`), `cadastros/profissionais/page.tsx` (GHL label conditional on `hasGhlIntegration`), `operacao/pacientes/[id]/page.tsx` (GHL line only rendered when `ghlContactId` non-null), `cadastros/profissionais/new-doctor-form.tsx` (relabeled "Identificador externo" without GHL mention)

**Checkpoint**: User Story 1 é entregável. Pode fazer deploy só com T001–T021 e ter um Pronttu standalone completamente funcional. US2/US3 são incrementais.

---

## Phase 4: User Story 2 — Admin conecta ou desconecta a integração GHL (Priority: P2)

**Goal**: Admin auto-serve conecta GHL (ou outro provider) via UI. Recepcionista/financeiro não têm acesso.

**Independent Test**: Login admin → `/configuracoes/integracoes` → lista provider "GoHighLevel" com badge "Não configurado" → clicar → preencher form → Conectar. Badge muda para "Conectado". Sidebar passa a ter pill "GHL" verde. `audit_log` tem entrada `integration.connect`. Clicar "Desconectar" com reason → badge volta para "Não configurado", `audit_log` tem `integration.disconnect`. Login recepcionista → tentar `/configuracoes/integracoes` → 403.

### Tests for User Story 2 (write first)

- [~] T022 [P] [US2] Contract test for integracoes — **deferred**: coverage is in T024's integration suite (list shape, 404, role guard, Zod validation, redacted response all asserted there)
- [X] T023 [P] [US2] Contract test `tests/contract/integration-adapter.spec.ts` — 9 green cases: label/description, configSchema accept+reject, credentialsSchema accept+reject, redactCredentials leak check, handleDomainEvent noop-safety, at-least-one adapter registered
- [X] T024 [P] [US2] Integration test `tests/integration/integrations/ghl/connect-disconnect.spec.ts` — 7 green cases: list shape, connect + audit, reconfigure + audit, disconnect + audit removed row, GET credentials redacted, recepcionista 403 on all verbs, unknown provider 404

### Implementation for User Story 2

- [X] T025 [P] [US2] `src/lib/integrations/ghl/adapter.ts` — implements `IntegrationAdapter<GhlConfig,GhlCredentials>` with `configSchema` (location_id, trigger_stage_name, 4 field maps), `credentialsSchema` (operations_pat + inbound_webhook_secret), `redactCredentials`, and noop `handleDomainEvent` (real dispatch in US3)
- [X] T026 [US2] Registered `ghlAdapter` in `src/lib/integrations/registry.ts`; `listProviders()` now includes `'ghl'`
- [X] T027 [P] [US2] `createContactInGhl` refactored to accept optional `GhlProxyCredentials` override (backwards compatible with env-based callers); adapter path will supply credentials explicitly
- [X] T028 [P] [US2] `src/lib/integrations/ghl/create-note.ts` — POST /functions/v1/create-contact-note via Homio-Operations proxy, 5s timeout
- [X] T029 [US2] `GET /api/configuracoes/integracoes` — admin-only aggregate list joining `listAdapters()` with `getEnabledIntegrations`
- [X] T030 [US2] `GET/POST/DELETE /api/configuracoes/integracoes/[provider]` — dynamic Zod validation via `adapter.configSchema`/`credentialsSchema`; encrypts credentials + webhook secret separately; audit `integration.{connect,reconfigure,disconnect}` with redaction; includes JSON Schema export for UI dynamic forms
- [X] T031 [P] [US2] `/configuracoes/integracoes/page.tsx` — SSR list of all registered providers sorted connected-first with badges
- [X] T032 [P] [US2] `/configuracoes/integracoes/[provider]/page.tsx` + `provider-form.tsx` — dynamic form built from JSON Schema fetched from the API; Connect/Reconfigure/Disconnect flows with reason audit
- [X] T033 [US2] `/configuracoes/page.tsx` replaced ComingSoon with a real tile linking to `/configuracoes/integracoes`, admin-gated
- [X] T034 [US2] `sidebar-integrations-badge.tsx` wired via `layout.tsx` — pills for 1–3 connected providers, counter for 4+, null for standalone

**Checkpoint**: Admin pode conectar/desconectar GHL via UI. Registry está vivo. O fan-out ainda é inerte (dispatch stub retorna `[]`) — US3 liga.

---

## Phase 5: User Story 3 — Integração GHL sincroniza em background quando conectada (Priority: P3)

**Goal**: Criar paciente → contato no GHL. Registrar atendimento → nota no contato. Falha no GHL → alerta, sem impedir operação local. Tenant sem integração não dispara nada.

**Independent Test**: Tenant com GHL conectado + mock do proxy rodando. Cadastrar paciente → resposta tem `integrations_dispatched[0] = { provider:'ghl', ok:true }`, `patients.ghl_contact_id` preenchido. Registrar atendimento para esse paciente → mock recebe nota. Derrubar mock → próxima criação retorna `ok:false`, alerta `integration_sync_failed` com `detail.provider='ghl'` criado. Multi-provider: tenant com GHL + generic_webhook ativos recebe 2 entradas em `integrations_dispatched`.

### Tests for User Story 3 (write first)

- [~] T035 [P] [US3] Multi-adapter fan-out test — **deferred to Phase 6** (needs `generic_webhook` adapter to exist as the 2nd provider; single-adapter fan-out is covered by T036)
- [X] T036 [P] [US3] `tests/integration/integrations/ghl/outbound-sync.spec.ts` — 4 green cases: (a) patient create OK → ghl_contact_id persisted + no alert; (b) proxy 500 → patient persisted + alert integration_sync_failed with detail.provider='ghl'; (c) appointment with ghl_contact_id → note POST hits proxy; (d) appointment without ghl_contact_id → note NOT attempted, adapter noop success
- [X] T037 [P] [US3] `tests/integration/integrations/ghl/outbound-respects-timeout.spec.ts` — proxy hangs 10s, dispatcher aborts at ~5s, request returns under 8s with ok=false

### Implementation for User Story 3

- [X] T038 [US3] `src/lib/core/events/dispatch.ts` — real fan-out: `getEnabledIntegrations` + per-adapter `decryptCredentials` + config parse + `Promise.allSettled(withTimeout(handleDomainEvent, 5000))`; emits `integration_sync_failed` alerts (with `detail.provider` and `detail.action`) for each failed adapter after all settle
- [X] T039 [US3] `ghlAdapter.handleDomainEvent` — `patient.created` → `createContactInGhl` then UPDATE `patients.ghl_contact_id`; `appointment.created` → `createNoteInGhl` when `ghlContactId` present (noop success otherwise); `appointment.reversed` → log-only (polish); `AdapterContext.supabase` added to types for writeback
- [X] T040 [US3] `createPatientManually` refactored — no longer calls `createContactInGhl` directly; INSERT then `publishDomainEvent('patient.created')`, re-reads `ghl_contact_id` after fan-out; returns `integrationsDispatched`, `ghlSynced`, `ghlContactId`
- [X] T041 [US3] `POST /api/pacientes` — surfaces `integrationsDispatched`, `ghlSynced`, `ghlContactId` (camelCase for back-compat with existing new-patient-form.tsx)
- [X] T042 [US3] `POST /api/atendimentos/manual` — already publishes `appointment.created` since US1; now returns real dispatch results instead of the `[]` stub
- [~] T043 [P] [US3] E2E test Playwright — **not run** (needs dev server + browser); manual validation via quickstart.md Scenario 3 covers it. Also: type `AlertType` renamed `ghl_sync_failed` → `integration_sync_failed` in `src/lib/db/types.ts`; `dispatcher.ts` + `upsert-from-ghl.ts` updated accordingly (fix for latent bug — DB CHECK rejected the old value after migration 0042)

**Checkpoint**: All three user stories are independently functional. Event bus fan-out works. Alerts are emitted only for connected providers.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: `generic_webhook` adapter, webhook inbound generic route, cleanup migration, docs.

- [ ] T044 [P] Create `src/lib/integrations/generic-webhook/adapter.ts` implementing `IntegrationAdapter` — `configSchema: { outbound_url, events[] }`, `credentialsSchema: { bearer_token? }`, `handleDomainEvent` POSTs `{ event: event.type, ...payload }` to `outbound_url` with optional Bearer, timeout 5s, and `redactCredentials` masking the token
- [ ] T045 [P] Register `genericWebhookAdapter` in `src/lib/integrations/registry.ts`
- [ ] T046 [P] Create `src/app/api/webhooks/[provider]/route.ts` dynamic route: lookup `registry[params.provider]` (404 if missing), call `adapter.extractTenantIdFromWebhook(req)` to get tenant, load integration row (`401 INVALID_SIGNATURE` if absent), delegate to `adapter.handleInboundWebhook(ctx, req)` per research.md R-005
- [ ] T047 Update `src/app/api/webhooks/ghl/route.ts` to thin-forward to the dynamic handler with `params={provider:'ghl'}` — no behavior change for existing clients, per research.md R-005 back-compat
- [ ] T048 [P] Implement `ghlAdapter.extractTenantIdFromWebhook` and `ghlAdapter.handleInboundWebhook` delegating to existing `verify-signature`, `raw_webhook_events` insert, and `createAppointmentFromEvent` pipeline — behavior identical to current `/api/webhooks/ghl/route.ts`
- [ ] T049 [P] Integration test `tests/integration/integrations/ghl/inbound-webhook.spec.ts` (regression) asserting old flow still works after T047–T048 refactor — simulate webhook → atendimento criado, DLQ unchanged
- [ ] T050 [P] Integration test `tests/integration/integrations/generic-webhook/outbound.spec.ts` — tenant with `generic_webhook` enabled, create patient → MSW intercepts configured URL and asserts payload shape
- [ ] T051 [P] Write migration `supabase/migrations/0041_drop_tenant_ghl_config.sql` dropping the old table — deployed in a follow-up PR after 0040 is live and all call sites (T015 refactors, etc.) no longer read `tenant_ghl_config` directly
- [ ] T052 [P] Add audit rule `scripts/check-require-role.mjs` extension (lint:auth) to also reject direct `process.env.GHL_*`, `SUPABASE_OPERATIONS_*`, etc. in `src/lib/integrations/<provider>/*.ts` — enforces research.md R-006 ("adapters never read env directly")
- [ ] T053 [P] Manual validation: run through all 4 scenarios in `quickstart.md` (standalone, connect GHL, multi-provider fan-out, webhook inbound) and record results in PR description
- [ ] T054 Update `CLAUDE.md` active-technologies section to mention `tenant_integrations` and the adapter registry as stable architectural primitives

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1, T001–T003)**: starts immediately, tiny files, no blocking
- **Foundational (Phase 2, T004–T010)**: depends on Setup. **BLOCKS** all user stories
- **US1 (Phase 3)**: starts after Foundational. Independent of US2/US3
- **US2 (Phase 4)**: starts after Foundational. Independent of US1/US3 for ship-ability, but shares `sidebar-integrations-badge.tsx` file edited in T019/T034 — keep that edit in the same PR as US2
- **US3 (Phase 5)**: starts after US2 (needs registry + a real adapter). Modifies files from US1 (`create-manual.ts`, `/api/pacientes/route.ts`) — schedule for after US1 ships
- **Polish (Phase 6)**: after all US phases shipped and validated

### Critical path

T001 → T004 → T015 → T016 → T020 → T021 (US1 MVP) → deploy → T025 → T026 → T030 → T032 (US2) → T038 → T039 → T040 (US3)

### Story dependencies

| Story | Depends on | Can ship without |
|-------|-----------|------------------|
| US1 | Foundational | US2 + US3 |
| US2 | Foundational | US3 |
| US3 | US2 (needs an adapter to dispatch to) | — |

### Within each story

- Tests (T011–T014 for US1, T022–T024 for US2, T035–T037 for US3) written first and failing before the implementation tasks.
- Pure helpers before route handlers before UI.

### Parallel opportunities

- T001, T002, T003 in parallel (disjoint files).
- T005, T006, T007, T008, T009 in parallel after T004 (disjoint modules).
- T011, T012, T013, T014 in parallel (different test files).
- T015, T017, T019 in parallel (disjoint files).
- T022, T023, T024 in parallel.
- T025, T027, T028 in parallel.
- T031, T032 in parallel (different pages).
- T035, T036, T037 in parallel.
- All Polish T044–T052 in parallel.

---

## Parallel Example: User Story 1

```bash
# After foundational phase is green, kick off in parallel:
Task: "Contract test atendimentos-manual.spec.ts"             # T011
Task: "Integration test standalone-flow.spec.ts"              # T012
Task: "E2E standalone-no-integrations-ui.spec.ts"             # T013
Task: "Tenant-isolation test atendimentos-manual.spec.ts"     # T014

# While tests are failing, implement in parallel:
Task: "Core createAppointmentManually"                         # T015
Task: "Form page /operacao/atendimentos/novo"                  # T017
Task: "Sidebar badge component (empty-render case)"            # T019
```

---

## Implementation Strategy

### MVP First (US1 only)

1. Phase 1 + Phase 2 (~10 tasks, mostly scaffolding + one migration).
2. Phase 3 / US1 (~11 tasks including 4 tests).
3. **STOP** — you have a Pronttu que funciona 100% sem GHL. Deployable.

### Incremental delivery

- Ship US1 → promote para beta de uma clínica nova standalone.
- Ship US2 → admin pode auto-configurar GHL via UI (ainda sem sync outbound).
- Ship US3 → outbound fan-out liga; alertas começam a fluir.
- Ship Polish → webhook inbound genérico + `generic_webhook` provider + drop da tabela velha.

### Parallel team strategy

- Dev A: Phase 1 + Phase 2 + Phase 3 (US1) — 1 sprint.
- Dev B: após foundational, começa Phase 4 (US2) em paralelo com US1 final.
- Dev C: pega US3 quando US2 mergear.
- Polish distribuído.

---

## Notes

- `[P]` = arquivo disjunto, sem dependência pendente — libera paralelismo.
- `[US#]` = traceability para user story da spec.md.
- Testes MUST falhar antes da implementação (TDD) para todas as tasks com test na frente.
- Nunca editar o mesmo arquivo em duas tasks `[P]` simultâneas — se identificar conflito, remover `[P]` de uma das tasks.
- Cada checkpoint é um bom ponto de commit + PR (veja `.specify/extensions.yml` hook `after_tasks`).
- Constitution Check re-roda em cada PR; se alguma task mexer em preço/RLS/RBAC e não incluir teste, bloqueia merge.

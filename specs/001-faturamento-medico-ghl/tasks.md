---
description: "Task list for Faturamento Médico GHL/Homio feature implementation"
---

# Tasks: Faturamento Médico Integrado ao GHL/Homio

**Input**: Design documents from `C:\My project\specs\001-faturamento-medico-ghl\`
**Prerequisites**: plan.md, spec.md (US1–US4), data-model.md, contracts/, research.md

**Tests**: INCLUDED and MANDATORY. The project constitution (Section 3 "Fluxo de Desenvolvimento & Quality Gates") requires contract, isolation, and role-matrix tests for any code touching finance, RBAC, or multi-tenant scoping. Every story below has its test block.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each slice.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Task can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4). Setup/Foundational/Polish tasks have no story label.
- All paths are absolute (repo-root relative when convenient).

## Path Conventions

- Next.js unified app in repo root: `src/app/*` (UI + Route Handlers), `src/lib/*` (domain + integrations).
- Database schema in `supabase/migrations/*.sql`.
- Tests in `tests/{contract,integration,e2e,unit}/`.
- Scripts and seeds in `scripts/` and `supabase/seed/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization, tooling, directory skeleton. No business logic yet.

- [ ] T001 Initialize Next.js 14 App Router TypeScript project at repo root (create `package.json`, `next.config.ts`, `tsconfig.json`, `.gitignore` including `.env.local`, `.next`, `coverage`)
- [ ] T002 [P] Install production dependencies in `package.json` (`next@14`, `react@18`, `react-dom@18`, `@supabase/supabase-js`, `@supabase/ssr`, `@upstash/qstash`, `@react-pdf/renderer`, `exceljs`, `zod`, `resend`, `pino`, `pino-pretty`)
- [ ] T003 [P] Install dev dependencies in `package.json` (`typescript@5.4`, `@types/node`, `@types/react`, `vitest`, `@vitest/coverage-v8`, `@playwright/test`, `tsx`, `msw`, `eslint`, `eslint-config-next`, `prettier`)
- [ ] T004 [P] Configure ESLint at `.eslintrc.json` and Prettier at `.prettierrc` (extend `next/core-web-vitals`, `prettier`; enforce `no-console` in `src/`)
- [ ] T005 Create directory skeleton per `plan.md` Structure Decision (`src/app/`, `src/app/api/`, `src/lib/core/`, `src/lib/integrations/`, `src/lib/db/`, `src/lib/auth/`, `src/lib/observability/`, `src/components/`, `supabase/migrations/`, `supabase/seed/`, `tests/contract/`, `tests/integration/`, `tests/e2e/`, `tests/helpers/`, `scripts/`)
- [ ] T006 [P] Configure Vitest in `vitest.config.ts` (Node environment, `tests/helpers/setup.ts` for Supabase local client bootstrap, 30 s timeout for integration suites)
- [ ] T007 [P] Configure Playwright in `playwright.config.ts` (baseURL `http://localhost:3000`, pt-BR locale, artifacts to `tests/e2e/artifacts/`)
- [ ] T008 [P] Create `.env.example` at repo root with all required variables per `quickstart.md` Section 2 (Supabase URLs, service-role key, `PATIENT_DATA_ENCRYPTION_KEY`, QStash keys, Resend keys)
- [ ] T009 [P] Configure structured logger at `src/lib/observability/logger.ts` (pino with redaction paths: `req.headers.authorization`, `req.body.patient.*`, `*.cpf`, `*.full_name`, `*.email`, `*.phone`, `*.birth_date`)
- [ ] T010 Initialize Supabase CLI project: run `supabase init`, then edit `supabase/config.toml` (timezone `America/Sao_Paulo`, JWT secret placeholder, auth hooks enabled)
- [ ] T011 [P] Create CI workflow at `.github/workflows/ci.yml` (jobs: `lint`, `typecheck`, `test-unit`, `test-integration` with Supabase service container, `test-contract`)
- [ ] T012 [P] Add npm scripts to `package.json` (`dev`, `build`, `start`, `lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `supabase:start`, `supabase:reset`, `supabase:diff`, `supabase:gen-types`, `seed:tuss`, `seed:demo`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, triggers, RLS, auth, observability, and test infra that ALL user stories depend on. Enforces the 5 constitution principles at the database layer.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Database schema (migrations are sequential by filename, can be authored in parallel)

- [ ] T013 Create migration `supabase/migrations/0001_extensions.sql` enabling `pgcrypto` and `pgsodium` (or gracefully skipping pgsodium if unavailable in region)
- [ ] T014 [P] Create migration `supabase/migrations/0002_tenants.sql`: tables `tenants`, `user_tenants` (PK user_id+tenant_id), `tenant_ghl_config` with encrypted `webhook_secret` column; add `updated_at` trigger
- [ ] T015 [P] Create migration `supabase/migrations/0003_tuss_catalog.sql`: global read-only tables `tuss_codes`, `tuss_catalog_versions` with indexes on `code`, `(valid_from, valid_to)`
- [ ] T016 [P] Create migration `supabase/migrations/0004_procedures_plans.sql`: `procedures` (UNIQUE tenant_id+tuss_code) and `health_plans` (UNIQUE tenant_id+name) tables
- [ ] T017 [P] Create migration `supabase/migrations/0005_doctors.sql`: `doctors` and `doctor_commission_history` tables, unique constraints on (tenant_id, crm) and (tenant_id, doctor_id, valid_from)
- [ ] T018 [P] Create migration `supabase/migrations/0006_price_versions.sql`: `price_versions` table with self-FK `previous_version_id`, UNIQUE (tenant_id, procedure_id, plan_id, valid_from), CHECK amount_cents>=0
- [ ] T019 [P] Create migration `supabase/migrations/0007_patients.sql`: `patients` with `*_enc BYTEA` columns, helper SQL functions `enc_text(text)` and `dec_text(bytea)` wrapping pgcrypto symmetric encryption using `PATIENT_DATA_ENCRYPTION_KEY` GUC
- [ ] T020 [P] Create migration `supabase/migrations/0008_appointments.sql`: `appointments` (FKs to patient, doctor, procedure, plan, source_price_version_id, source_commission_history_id, source_raw_event_id with UNIQUE), `appointment_reversals` (UNIQUE appointment_id, CHECK reversal_amount_cents<0), and view `appointments_effective` per data-model.md §6
- [ ] T021 [P] Create migration `supabase/migrations/0009_webhook_events.sql`: `raw_webhook_events` (UNIQUE tenant_id+ghl_event_id), `webhook_event_transitions`, view `dlq_events`
- [ ] T022 [P] Create migration `supabase/migrations/0010_alerts.sql`: `alerts`, `alert_status_transitions`
- [ ] T023 [P] Create migration `supabase/migrations/0011_audit_log.sql`: `audit_log` table with all required fields per data-model.md §9, including `CHECK (result IN ('success','denied','conflict'))` to support FR-005b conflict entries

### Triggers (enforce constitution Principles I and II at DB layer)

- [ ] T024 Create migration `supabase/migrations/0012_append_only_triggers.sql`: function `enforce_append_only()` raising exception on UPDATE/DELETE; attach to `appointments`, `appointment_reversals`, `price_versions`, `doctor_commission_history`, `audit_log`, `raw_webhook_events` (payload columns only), `webhook_event_transitions`, `alert_status_transitions`; document exception via `SESSION_USER='supabase_admin'`
- [ ] T025 Create migration `supabase/migrations/0013_audit_triggers.sql`: function `log_audit()` reading `current_setting('app.actor_id')`, `app.ip`, `app.user_agent`; attach AFTER INSERT triggers on `price_versions`, `doctor_commission_history`, `procedures`, `appointments`, `appointment_reversals`, `patients`
- [ ] T026 Create migration `supabase/migrations/0014_tuss_validation_trigger.sql`: BEFORE INSERT trigger on `procedures` validating `tuss_code` exists in `tuss_codes` with NULL `valid_to`; error message includes the code
- [ ] T027 Create migration `supabase/migrations/0015_appointment_validation_trigger.sql`: BEFORE INSERT trigger on `appointments` that verifies (a) active `price_versions` row exists for (tenant_id, procedure_id, plan_id) with `valid_from <= appointment_at::date` — raises `APPOINTMENT_PRICE_MISSING` on failure — AND (b) the referenced procedure's `tuss_code` still has a matching `tuss_codes` row with `valid_to IS NULL` at appointment time — raises `TUSS_CODE_RETIRED` on failure (FR-016). Both exceptions are caught by the worker and route the event to DLQ with the failure code.

### Row-Level Security and grants (Principle III + V)

- [ ] T028 Create migration `supabase/migrations/0016_rls_enable.sql`: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` for every tenant-scoped table; leave `tuss_codes`, `tuss_catalog_versions` RLS-disabled (global read-only)
- [ ] T029 Create migration `supabase/migrations/0017_rls_policies.sql`: `tenant_isolation` policy (`USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid)`) on every tenant table; role-gated write policies on `price_versions`, `procedures`, `health_plans`, `doctors`, `doctor_commission_history`, `tenant_ghl_config` (require `role='admin'`); `appointment_reversals` write requires `role IN ('admin','financeiro')`
- [ ] T030 Create migration `supabase/migrations/0018_grants.sql`: revoke `UPDATE` and `DELETE` from role `authenticated` on all append-only financial tables; grant only `SELECT, INSERT` on the same tables; grant `UPDATE(processing_status, last_processed_at, processing_attempt_count)` on `raw_webhook_events` to service-role only

### TUSS catalog seed (Principle IV + follow-up from research R5)

- [ ] T031 [P] Implement `scripts/seed-tuss.ts`: downloads `github.com/charlesfgarcia/tabelas-ans` at a pinned commit SHA, parses files, inserts into `tuss_codes`, records a new `tuss_catalog_versions` row with commit SHA and content hash
- [ ] T032 Add license verification step in `scripts/seed-tuss.ts` (same file as T031; depends on T031): reads LICENSE file from the downloaded repo; logs license name + URL; aborts import with a clear error if LICENSE is missing or not permissive (resolves R5 follow-up TODO before production seed)
- [ ] T032a Implement `src/lib/core/catalog/detect-deprecated.ts` — scans the tenant's `procedures` and `price_versions` for any `tuss_code` whose `tuss_codes` row now has `valid_to IS NOT NULL`; emits one alert per (tenant, tuss_code) with `type='tuss_deprecated'` via the dispatcher from T047; deduplicates against existing open alerts
- [ ] T032b Invoke `detect-deprecated` at the end of `scripts/seed-tuss.ts` so every catalog refresh fans out alerts to tenants affected by newly-retired codes (depends on T031, T032, T032a, T047)
- [ ] T032c [P] Integration test `tests/integration/tuss-deprecation-alert.spec.ts` — seed a procedure referencing an active TUSS; flip that TUSS row `valid_to` to a past date; run `detect-deprecated`; assert an `alerts` row with `type='tuss_deprecated'` exists for the affected tenant and the Resend client was called

### Supabase Auth and typed clients

- [ ] T033 Create SQL function `supabase/migrations/0019_auth_hook_custom_claims.sql` triggered on `auth.users` sign-in that reads `user_tenants` and returns JWT claims `tenant_id` and `role`; register via `supabase/config.toml` auth hooks section
- [ ] T034 [P] Create `src/lib/db/supabase-browser.ts` (browser client using anon key)
- [ ] T035 [P] Create `src/lib/db/supabase-server.ts` (SSR/Route Handler server client reading cookies; respects RLS via user JWT)
- [ ] T036 [P] Create `src/lib/db/supabase-service.ts` (service-role client; module enforces usage only from `src/app/api/webhooks/` and `src/app/api/workers/` via a call-site guard that throws when imported elsewhere)
- [ ] T037 [P] Create `src/lib/db/types.ts` placeholder that imports from `src/lib/db/generated/types.ts` (regenerated via `pnpm supabase:gen-types` after migrations apply)

### Auth helpers and RBAC

- [ ] T038 [P] Create `src/lib/auth/get-session.ts` (reads JWT from cookies; returns `{ user, tenantId, role }` or null)
- [ ] T039 [P] Create `src/lib/auth/require-role.ts` (throws `ForbiddenError` if session role not in allowed list; logs deny to audit via `src/lib/core/audit/deny.ts`)
- [ ] T040 [P] Create `src/lib/auth/rbac.ts` (role constants, permission matrix `can(role, action, resource)`; used by UI for hiding controls; server always re-checks)

### Observability and errors

- [ ] T041 [P] Create `src/lib/observability/trace.ts` (mint `trace_id`; context helpers to stamp `tenant_id`, `user_id` on pino log lines)
- [ ] T042 [P] Create `src/lib/observability/errors.ts` (error classes `ValidationError`, `ForbiddenError`, `ConflictError`, `NotFoundError`, `DomainError` with typed `code` field for HTTP mapping)
- [ ] T043 [P] Create `src/lib/observability/http.ts` (Route-Handler helper `toHttpResponse(err)` mapping error classes → HTTP status + JSON body)

### Email (Resend) and queue (QStash) integrations

- [ ] T044 [P] Create `src/lib/integrations/email/resend-client.ts` (typed wrapper; helper `sendAlertEmail({ tenantId, subject, bodyRef })` that never embeds PII per FR-037)
- [ ] T045 [P] Create `src/lib/integrations/queue/qstash-client.ts` (helper `enqueueGhlEvent(rawEventId)` targeting `/api/workers/process-ghl-event`)
- [ ] T046 [P] Create `src/lib/integrations/queue/verify-qstash-signature.ts` (HMAC verification for QStash incoming webhook)

### Core alerts dispatcher (reused by US1–US3)

- [ ] T047 Create `src/lib/core/alerts/dispatcher.ts` (domain function `dispatchAlert({ tenantId, type, subjectRef, detail })` that INSERTs into `alerts`, records `alert_status_transitions`, and calls `sendAlertEmail`; deduplicates by `(tenant_id, type, subject_ref)` within 1 hour)
- [ ] T048 [P] Create `src/lib/core/audit/deny.ts` (helper that inserts a denied-attempt row in `audit_log` with `result='denied'`)

### Base UI scaffolding

- [ ] T049 [P] Create `src/app/layout.tsx` (root layout, pt-BR lang, Inter font)
- [ ] T050 [P] Create `src/app/(auth)/login/page.tsx` (Supabase Auth login form, redirect to `/dashboard`)
- [ ] T051 [P] Create `src/app/(dashboard)/layout.tsx` (role-aware navigation, tenant badge, sign-out)
- [ ] T052 [P] Create `middleware.ts` at repo root (redirects unauthenticated requests from `/dashboard/*` and `/api/*` except `/api/webhooks/*` and `/api/workers/*` to `/login`)

### Test infrastructure

- [ ] T053 Create `tests/helpers/supabase-test-client.ts` (spins up `supabase start` before suite, `supabase stop` after; exports service-role client and RLS client factory)
- [ ] T054 [P] Create `tests/helpers/seed-factories.ts` (builders for tenants, users with roles, procedures with valid TUSS codes, plans, doctors, commission history, price versions)
- [ ] T055 [P] Create `tests/helpers/jwt-helper.ts` (mint JWTs with arbitrary `tenant_id` + `role` claims signed with local Supabase JWT secret)
- [ ] T056 [P] Create `tests/helpers/contract-runner.ts` (loads an OpenAPI YAML from `specs/001-faturamento-medico-ghl/contracts/` and validates request/response shapes using `zod-to-json-schema` reverse)

### Constitution-level integration tests (run first; must pass on empty app before any story work)

- [ ] T057 [P] Integration test `tests/integration/append-only.spec.ts` — attempts UPDATE and DELETE via SQL as `authenticated` role on `appointments`, `appointment_reversals`, `price_versions`, `audit_log`, `doctor_commission_history`; all MUST raise the trigger exception (validates Principle I)
- [ ] T058 [P] Integration test `tests/integration/tenant-isolation.spec.ts` — creates two tenants A and B, authenticates as A, attempts SELECT/INSERT on every tenant-scoped table referencing B's ids; all MUST fail (validates Principle III)
- [ ] T059 [P] Integration test `tests/integration/audit-trail.spec.ts` — INSERTs into `price_versions`, `doctor_commission_history`, `procedures`, `appointments`, `appointment_reversals`; asserts corresponding `audit_log` row exists with every required field filled (validates Principle II)
- [ ] T060 [P] Integration test `tests/integration/rbac-matrix.spec.ts` — matrix of (role × endpoint) using `jwt-helper`; every unauthorized combination returns 403 and records a `result='denied'` row in `audit_log` (validates Principle V)

**Checkpoint**: Foundation ready. User story implementation can now begin.

---

## Phase 3: User Story 1 — Atendimento faturado automaticamente via webhook GHL (Priority: P1) 🎯 MVP

**Goal**: End-to-end automation. GHL webhook → evento bruto persistido síncrono (200 rápido) → processamento semântico assíncrono via QStash → atendimento com valor e comissão congelados. Falhas operacionais viram alertas por e-mail + dashboard.

**Independent Test**: Com uma clínica seed (1 procedimento TUSS, 1 plano Unimed a R$ 250,00 vigente, 1 médico com 40% comissão), disparar POST `/api/webhooks/ghl` com payload válido. Verificar (a) resposta 200 em <1 s, (b) atendimento criado em `appointments` com `frozen_amount_cents=25000` e `frozen_commission_bps=4000`, (c) reenvio do mesmo evento não cria atendimento duplicado, (d) remover custom field obrigatório → evento vai para DLQ + alerta de e-mail é despachado.

### Tests for User Story 1 (write first, MUST fail before implementation)

- [ ] T061 [P] [US1] Contract test `tests/contract/webhook-ghl.spec.ts` validates request/response shape of POST `/api/webhooks/ghl` against `contracts/webhook-ghl.yaml`
- [ ] T062 [P] [US1] Contract test `tests/contract/reversal.spec.ts` validates `/api/atendimentos/{id}/reversal` against `contracts/atendimentos.yaml` (reversal slice of US1)
- [ ] T063 [P] [US1] Integration test `tests/integration/webhook-happy-path.spec.ts` — seeded tenant; POST webhook; assert raw event persisted; after worker processes, assert appointment with frozen values matches seed
- [ ] T064 [P] [US1] Integration test `tests/integration/webhook-idempotency.spec.ts` — same `ghl_event_id` delivered twice; second returns `duplicate:true`; only one row in `appointments`
- [ ] T065 [P] [US1] Integration test `tests/integration/webhook-missing-field.spec.ts` — payload without `plano` custom field; worker routes to DLQ; `alerts` row created with `type='webhook_rejected'`; e-mail dispatched (MSW spy)
- [ ] T066 [P] [US1] Integration test `tests/integration/webhook-unknown-tuss.spec.ts` — TUSS code not in catalog; DLQ + alert
- [ ] T067 [P] [US1] Integration test `tests/integration/webhook-no-price.spec.ts` — combination (procedure, plan) without any `price_versions` row; DLQ + alert with combination in `detail`
- [ ] T067a [P] [US1] Integration test `tests/integration/webhook-tuss-retired-between-setup-and-atendimento.spec.ts` — seed procedure with active TUSS; later flip `tuss_codes.valid_to` to past; fire webhook referencing that procedure; assert event lands in DLQ with `failure_reason='TUSS_CODE_RETIRED'` (validates FR-016 at appointment time)
- [ ] T068 [P] [US1] Integration test `tests/integration/webhook-signature-invalid.spec.ts` — bad HMAC header; endpoint returns 401; `alert` with `type='signature_failure'`
- [ ] T069 [P] [US1] Integration test `tests/integration/appointment-price-snapshot.spec.ts` — create appointment; afterwards create newer `price_versions` row; re-read appointment; `frozen_amount_cents` unchanged
- [ ] T070 [P] [US1] Integration test `tests/integration/appointment-commission-snapshot.spec.ts` — create appointment; afterwards insert new `doctor_commission_history`; re-read appointment; `frozen_commission_bps` unchanged
- [ ] T071 [P] [US1] Integration test `tests/integration/reversal-flow.spec.ts` — create appointment; POST reversal; assert `appointments_effective.effective_status='estornado'` and `net_amount_cents` is the expected zero-sum
- [ ] T072 [P] [US1] Integration test `tests/integration/reversal-duplicate-blocked.spec.ts` — second reversal on same appointment returns 409
- [ ] T073 [P] [US1] Integration test `tests/integration/reversal-rbac.spec.ts` — recepcionista and profissional_saude receive 403 on reversal endpoint
- [ ] T074 [P] [US1] Integration test `tests/integration/alert-email-no-pii.spec.ts` — triggers a `webhook_rejected` alert involving a known patient; asserts the Resend payload body and subject contain no `cpf`, `full_name`, `phone`, `email` tokens (validates SC-013 / FR-037)
- [ ] T074a [P] [US1] Integration test `tests/integration/patient-update-no-appointment-drift.spec.ts` — create appointment for patient P; update P's phone/email via `upsert-from-ghl`; re-read appointment and assert `patient_id` unchanged, `frozen_amount_cents` unchanged, and nothing in `appointments` was mutated (validates FR-010b)
- [ ] T075 [P] [US1] E2E test `tests/e2e/webhook-to-dashboard.spec.ts` — using Playwright, simulate webhook via API call, then navigate to `/dashboard/atendimentos` and assert the new row appears with correct values

### Integration layer (GHL & QStash)

- [ ] T076 [P] [US1] Implement `src/lib/integrations/ghl/verify-signature.ts` — HMAC-SHA256 of timestamp+payload with tenant secret; rejects if timestamp drift > 5 min
- [ ] T077 [P] [US1] Implement `src/lib/integrations/ghl/extract-custom-fields.ts` — Zod schema builder parameterized by `tenant_ghl_config`; returns typed `ExtractedEvent` or throws `ValidationError` listing missing fields

### Raw event ingestion and idempotency

- [ ] T078 [US1] Implement `src/lib/core/webhooks/ingest-raw-event.ts` — INSERT into `raw_webhook_events` using `ON CONFLICT DO NOTHING RETURNING id`; returns `{ rawEventId, duplicate }`; appends row in `webhook_event_transitions` with `to_status='pending'`

### Semantic processing (worker path)

- [ ] T079 [US1] Implement `src/lib/core/pricing/resolve-price.ts` — given (tenantId, procedureId, planId, asOfDate) returns the active `price_versions` row ordering by `valid_from DESC, created_at DESC`; throws `DomainError('APPOINTMENT_PRICE_MISSING')` if none
- [ ] T080 [US1] Implement `src/lib/core/commissions/resolve-commission.ts` — given (tenantId, doctorId, asOfDate) returns the active `doctor_commission_history` row; throws if none
- [ ] T081 [US1] Implement `src/lib/core/patients/upsert-from-ghl.ts` — INSERT ... ON CONFLICT (tenant_id, ghl_contact_id) DO UPDATE for mutable fields; encrypts name/CPF/phone/email/birth_date using `enc_text()` SQL function; returns `patient_id`
- [ ] T082 [US1] Implement `src/lib/core/appointments/create-from-event.ts` — orchestrates: `upsert-from-ghl` → `resolve-price` → `resolve-commission` → INSERT `appointments` with source FKs populated; wraps in transaction with `SET LOCAL app.actor_id='worker:process-ghl-event'` so audit trigger attributes correctly
- [ ] T083 [US1] Implement `src/lib/core/webhooks/process-event.ts` — reads raw event by id; sets `processing_status='processing'` with status transition; calls `create-from-event`; on success sets `done`; on `DomainError`/`ValidationError` sets `dlq` and calls `dispatchAlert` with appropriate type; on transient failure re-throws to QStash retry

### API Route Handlers

- [ ] T084 [US1] Implement `src/app/api/webhooks/ghl/route.ts` POST handler — identifies tenant from `X-GHL-Signature` header decoding (looks up `tenant_ghl_config.webhook_secret` that matches); verifies signature via T076; persists raw event via T078; enqueues QStash message via T045; returns 200 with `{ received, duplicate, raw_event_id }` in <1 s
- [ ] T085 [US1] Implement `src/app/api/workers/process-ghl-event/route.ts` POST handler — verifies QStash signature via T046; reads `rawEventId` from body; calls T083; returns 200 on success, 5xx on transient error (QStash retry), 200 on terminal failure already routed to DLQ
- [ ] T086 [US1] Implement `src/app/api/atendimentos/route.ts` GET handler — lists from `appointments_effective` view with query filters (from, to, doctor_id, plan_id, status); respects RLS
- [ ] T087 [US1] Implement `src/app/api/atendimentos/[id]/route.ts` GET handler — returns single appointment from `appointments_effective` + joined audit history
- [ ] T088a [US1] Implement `src/lib/core/appointments/reverse.ts` — domain module that inserts `appointment_reversals` with `reversal_amount_cents = -original_frozen_amount_cents`, enforces UNIQUE (single reversal per appointment) via catch of 23505 mapped to `ConflictError`, validates caller role via passed session, and sets `SET LOCAL app.actor_id` so audit trigger attributes correctly
- [ ] T088b [US1] Implement `src/app/api/atendimentos/[id]/reversal/route.ts` POST handler — thin wrapper that calls `require-role(['admin','financeiro'])` then delegates to `reverse.ts` (T088a); returns 201 on success, 409 on duplicate, 403 on role mismatch; audit via trigger
- [ ] T089 [US1] Implement `src/app/api/alertas/route.ts` GET handler — lists alerts for current tenant with status filter
- [ ] T090 [US1] Implement `src/app/api/alertas/[id]/resolve/route.ts` POST handler — sets alert `status='resolvido'`, records transition; admin only
- [ ] T091 [US1] Implement `src/app/api/alertas/dlq/route.ts` GET handler — lists from `dlq_events` view
- [ ] T092 [US1] Implement `src/app/api/alertas/dlq/[id]/reprocess/route.ts` POST handler — re-enqueues via QStash; transitions raw event from `dlq` to `processing`; admin only

### UI (dashboards needed to operate US1)

- [ ] T093 [US1] Create `src/app/(dashboard)/atendimentos/page.tsx` — table of appointments from `appointments_effective`; filters; visual indicator for `estornado`
- [ ] T094 [P] [US1] Create `src/app/(dashboard)/atendimentos/[id]/page.tsx` — detail view with audit history and reversal action (button enabled only for `admin`/`financeiro`)
- [ ] T095 [P] [US1] Create `src/app/(dashboard)/alertas/page.tsx` — list of alerts with status filter; resolve button (admin)
- [ ] T096 [P] [US1] Create `src/app/(dashboard)/dlq/page.tsx` — DLQ browser showing `failure_reason` and `payload_summary`; reprocess button (admin)

### Demo seed and dev tooling

- [ ] T097 [P] [US1] Create `supabase/seed/demo-tenant.ts` — seeds 1 tenant, 1 admin user, 1 recepcionista user, 3 procedures, 3 health plans (Unimed, Bradesco, Particular), 2 doctors with commissions, 5 price_versions, tenant_ghl_config with `webhook_secret='dev-shared-secret'`
- [ ] T098 [P] [US1] Create `scripts/simulate-ghl-webhook.ts` — CLI that builds a signed payload matching the demo tenant's secret and POSTs to local `/api/webhooks/ghl`; used by `quickstart.md` Section 5

### Observability wiring

- [ ] T099 [US1] Thread `trace_id` through the hot path: generated at webhook endpoint, added to QStash message headers, restored in worker; logged on every `logger.info`/`logger.error` call in `ingest-raw-event`, `process-event`, `create-from-event`

**Checkpoint**: US1 (MVP) fully functional and demonstrable. A webhook to a fresh tenant produces an appointment visible in the dashboard, with reversal, alerts dashboard, and DLQ reprocessing all working end-to-end.

---

## Phase 4: User Story 2 — Gestão de tabela de preços com vigência futura e histórico imutável (Priority: P2)

**Goal**: Admin pode criar e alterar preços com vigência futura via UI; concorrência otimista bloqueia edição baseada em dado obsoleto; histórico preservado.

**Independent Test**: Admin seed; criar primeiro preço; alterar com `valid_from` futura → antigo atendimento mantém valor original; dois admins simulados editam simultaneamente → segundo recebe 409; tentativa de admin deletar versão histórica é bloqueada por trigger.

### Tests for User Story 2

- [ ] T100 [P] [US2] Contract test `tests/contract/precos.spec.ts` against `contracts/precos.yaml`
- [ ] T101 [P] [US2] Integration test `tests/integration/price-creation-happy.spec.ts` — admin creates first version then new version with `valid_from` = next month; list endpoint returns correct head for today and future date
- [ ] T102 [P] [US2] Integration test `tests/integration/price-future-does-not-affect-past.spec.ts` — seeded appointment; admin creates new price with past `valid_from`; asserts appointment `frozen_amount_cents` unchanged (reinforces US1 T069 at HTTP layer)
- [ ] T103 [P] [US2] Integration test `tests/integration/price-optimistic-concurrency.spec.ts` — two sessions load same head id; first submits new version successfully; second submits with stale `expected_head_id` and receives 409 `PRICE_VERSION_CONFLICT`; audit log records the 409 with `result='conflict'`
- [ ] T104 [P] [US2] Integration test `tests/integration/price-unique-collision.spec.ts` — two admins submit versions with exact same `valid_from` through a race that bypasses the chain head check; database UNIQUE constraint surfaces as 409 (belt-and-suspenders)
- [ ] T105 [P] [US2] Integration test `tests/integration/price-recepcionista-forbidden.spec.ts` — recepcionista POSTs price version → 403; audit row with `result='denied'`
- [ ] T106 [P] [US2] Integration test `tests/integration/price-tuss-invalid.spec.ts` — admin attempts to create procedure with unknown TUSS code → 400 from trigger; no row created
- [ ] T107 [P] [US2] E2E test `tests/e2e/price-change.spec.ts` — Playwright: admin logs in, opens price, edits, saves; reopens detail and verifies new head + history list

### Domain

- [ ] T108 [US2] Implement `src/lib/core/pricing/create-version.ts` — opens transaction, SELECT current head FOR UPDATE, compares to `expected_head_id`; INSERT new version with `previous_version_id=head.id`; throws `ConflictError` on mismatch; catches UNIQUE violation and maps to `ConflictError` with `current_head_id`
- [ ] T109 [P] [US2] Implement `src/lib/core/pricing/list-heads.ts` — returns current head per (procedure, plan) with joined names for the dashboard
- [ ] T110 [P] [US2] Implement `src/lib/core/pricing/history.ts` — full chain ordered by `valid_from DESC, created_at DESC`

### API

- [ ] T111 [US2] Implement `src/app/api/precos/route.ts` GET — calls T109; supports query filters
- [ ] T112 [US2] Implement `src/app/api/precos/versions/route.ts` POST — validates with Zod; calls T108; returns 409 on conflict; on `ConflictError` MUST call `audit.deny({ result: 'conflict', reason: 'conflito de concorrência', entity: 'price_versions', entity_id: currentHeadId })` before responding (FR-005b); returns 403 on role mismatch (audit via `require-role`)
- [ ] T113 [US2] Implement `src/app/api/precos/versions/[id]/history/route.ts` GET — calls T110

### UI

- [ ] T114 [US2] Create `src/app/(dashboard)/precos/page.tsx` — table of current prices; filters by procedure/plan; "New price" and row action "Edit"
- [ ] T115 [P] [US2] Create `src/app/(dashboard)/precos/[id]/page.tsx` — detail + history + edit form that carries `expected_head_id` hidden; on 409 shows modal explaining conflict and reloads data
- [ ] T116 [P] [US2] Create `src/app/(dashboard)/precos/novo/page.tsx` — form to create first version for a new (procedure, plan) combination

### Auxiliary cadastros (procedimentos + planos + auditoria) — belongs to US2 slice because admin must manage them to exercise US2 price flow

- [ ] T158 [P] [US2] Contract test `tests/contract/procedimentos.spec.ts` against `contracts/procedimentos.yaml`
- [ ] T159 [P] [US2] Contract test `tests/contract/planos.spec.ts` against `contracts/planos.yaml`
- [ ] T160 [P] [US2] Integration test `tests/integration/procedure-tuss-invalid-rejected.spec.ts` — admin POST `/api/procedimentos` with unknown or retired TUSS → 400; nothing inserted; audit entry with `result='denied'`
- [ ] T161 [P] [US2] Integration test `tests/integration/plano-recepcionista-forbidden.spec.ts` — recepcionista POST/PATCH `/api/planos` → 403; audit records denial
- [ ] T162 [P] [US2] Implement `src/lib/core/procedures/create.ts`, `list.ts`, `update-active.ts` (TUSS validation delegated to trigger from T026)
- [ ] T163 [P] [US2] Implement `src/lib/core/plans/create.ts`, `list.ts`, `update-active.ts` (renome proibido; apenas `active` é mutável para preservar integridade histórica de relatórios)
- [ ] T164 [US2] Implement `src/app/api/procedimentos/route.ts` (GET + POST) and `src/app/api/procedimentos/[id]/route.ts` (PATCH) — admin-only writes
- [ ] T165 [US2] Implement `src/app/api/planos/route.ts` (GET + POST) and `src/app/api/planos/[id]/route.ts` (PATCH) — admin-only writes
- [ ] T166 [US2] Create `src/app/(dashboard)/procedimentos/page.tsx` — list + add + toggle active (admin); recepcionista vê em modo read-only
- [ ] T167 [US2] Create `src/app/(dashboard)/planos/page.tsx` — list + add + toggle active (admin); recepcionista read-only
- [ ] T168 [P] [US2] Contract test `tests/contract/auditoria.spec.ts` against `contracts/auditoria.yaml` (export CSV and JSON shapes)
- [ ] T169 [P] [US2] Integration test `tests/integration/audit-export-fields.spec.ts` — generates audit entries across several tracked tables; GET `/api/auditoria/export?format=csv` and `format=json`; asserts every required field (actor_id, actor_label, timestamp_utc, tenant_id, entity, entity_id, field, old_value, new_value, reason, ip, user_agent, result) appears in the output without transformation (validates FR-019)
- [ ] T170 [US2] Implement `src/lib/core/audit/export.ts` + `src/app/api/auditoria/route.ts` (GET, paginated; admin-only via `require-role(['admin'])`) + `src/app/api/auditoria/export/route.ts` (CSV streaming via `Response` body stream and JSON via buffer); plus UI action in `src/app/(dashboard)/auditoria/page.tsx` with date/entity/result filters and download buttons

**Checkpoint**: US1 + US2 both independently functional. Admin can manage prices, procedures, plans, and export the audit trail; webhook automation continues to work and uses the new prices for future appointments.

---

## Phase 5: User Story 3 — Cadastro de médicos e comissão (Priority: P2)

**Goal**: Admin cadastra médicos com comissão individual; alterações preservam histórico; atendimentos antigos mantêm snapshot.

**Independent Test**: Criar Dr. Silva com 40%; criar atendimento seed (ou reutilizar o criado por US1); alterar para 45%; atendimentos antigos mantêm 40%; recepcionista não consegue alterar.

### Tests for User Story 3

- [ ] T117 [P] [US3] Contract test `tests/contract/medicos.spec.ts` against `contracts/medicos.yaml`
- [ ] T118 [P] [US3] Integration test `tests/integration/doctor-create-list.spec.ts`
- [ ] T119 [P] [US3] Integration test `tests/integration/commission-version-append-only.spec.ts` — new commission creates new `doctor_commission_history` row; UPDATE attempt on the existing row blocked by trigger
- [ ] T120 [P] [US3] Integration test `tests/integration/commission-snapshot-preserved.spec.ts` — same as US1 T070 but through public API flow: change commission; older appointments unchanged
- [ ] T121 [P] [US3] Integration test `tests/integration/doctor-rbac.spec.ts` — recepcionista receives 403 on POST `/api/medicos`, POST commission; audit records denial
- [ ] T122 [P] [US3] Integration test `tests/integration/doctor-unique-crm.spec.ts` — second doctor with same CRM in same tenant → 409; different tenant → OK

### Domain

- [ ] T123 [P] [US3] Implement `src/lib/core/doctors/create.ts` (validates CRM format, optional `external_identifier`, creates initial `doctor_commission_history` row)
- [ ] T124 [P] [US3] Implement `src/lib/core/doctors/list.ts` and `src/lib/core/doctors/update.ts` (update only allows `full_name`, `active`)
- [ ] T125 [P] [US3] Implement `src/lib/core/commissions/create-version.ts` (new `doctor_commission_history` row; audit via trigger)

### API

- [ ] T126 [US3] Implement `src/app/api/medicos/route.ts` GET + POST
- [ ] T127 [US3] Implement `src/app/api/medicos/[id]/route.ts` GET + PATCH
- [ ] T128 [US3] Implement `src/app/api/medicos/[id]/commission/route.ts` POST

### UI

- [ ] T129 [US3] Create `src/app/(dashboard)/medicos/page.tsx` (list + new)
- [ ] T130 [P] [US3] Create `src/app/(dashboard)/medicos/[id]/page.tsx` (detail, commission history, new-commission form; admin-only controls)

**Checkpoint**: US1 + US2 + US3 independently functional.

---

## Phase 6: User Story 4 — Relatório mensal financeiro exportável em PDF e Excel (Priority: P3)

**Goal**: Admin/Financeiro geram relatório mensal com receita por plano, produção por médico e comissão líquida (considerando estornos); exportam em PDF e Excel com os mesmos totais.

**Independent Test**: Clínica com ao menos 10 atendimentos (2 planos × 2 médicos) em março/2026; gerar relatório; exportar PDF e Excel; totais batem entre tela, PDF e Excel; atendimento revertido reduz receita/comissão no relatório.

### Tests for User Story 4

- [ ] T131 [P] [US4] Contract test `tests/contract/relatorios.spec.ts` against `contracts/relatorios.yaml`
- [ ] T132 [P] [US4] Integration test `tests/integration/report-aggregation.spec.ts` — seed matrix of appointments; assert `revenue_by_plan`, `production_by_doctor`, `totals.net_revenue_cents`, `net_commission_cents` all match hand-calculated values; includes reversal case reducing totals
- [ ] T133 [P] [US4] Integration test `tests/integration/report-snapshot-stability.spec.ts` — run report; change a price vigência futura; re-run for same period; totals unchanged
- [ ] T134 [P] [US4] Integration test `tests/integration/report-export-parity.spec.ts` — compare JSON totals vs PDF extracted text vs Excel cell values; every number matches (validates SC-006)
- [ ] T135 [P] [US4] Integration test `tests/integration/report-rbac.spec.ts` — recepcionista receives 403 on GET relatório and GET export
- [ ] T136 [P] [US4] Integration test `tests/integration/report-empty-period.spec.ts` — month with zero appointments returns zeros, not error
- [ ] T137 [P] [US4] Performance test `tests/integration/report-performance.spec.ts` — seed 5 000 appointments for a single tenant-month; assert GET `/api/relatorios/mensal` completes under 30 s (SC-004)
- [ ] T138 [P] [US4] E2E test `tests/e2e/monthly-report-export.spec.ts` — Playwright: admin opens report, selects period, clicks Export PDF and Export Excel; downloads complete and files are non-empty

### Domain

- [ ] T139 [US4] Implement `src/lib/core/reports/monthly.ts` — queries `appointments_effective` with aggregation GROUP BY plan_id and GROUP BY doctor_id; returns the `MonthlyReport` shape from the contract
- [ ] T140 [P] [US4] Implement `src/lib/core/reports/export-pdf.tsx` — `@react-pdf/renderer` components for cover + revenue table + production table + totals; consumes the same `MonthlyReport` DTO
- [ ] T141 [P] [US4] Implement `src/lib/core/reports/export-excel.ts` — `exceljs` workbook with sheets "Receita por Plano", "Produção por Médico", "Totais"; same DTO source

### API

- [ ] T142 [US4] Implement `src/app/api/relatorios/mensal/route.ts` GET — calls T139; `admin`/`financeiro` only
- [ ] T143 [US4] Implement `src/app/api/relatorios/mensal/export/[formato]/route.ts` GET — dispatches to T140 or T141; streams response with correct MIME and `Content-Disposition: attachment`

### UI

- [ ] T144 [US4] Create `src/app/(dashboard)/relatorios/mensal/page.tsx` — period selector (default current month); tabs for revenue and production; "Exportar PDF" and "Exportar Excel" buttons

**Checkpoint**: All four user stories independently functional. MVP + full v1 feature scope complete.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Quality gates, performance validation against success criteria, operational readiness.

- [ ] T145 [P] Run `pnpm lint` and fix any violations; enforce `no-console` outside `logger.ts`
- [ ] T146 [P] Run `pnpm typecheck` and resolve any TypeScript errors
- [ ] T147 [P] Performance validation against SC-001a/b/c — benchmark webhook endpoint under synthetic load (`k6` or similar); record p50/p95/p99; document in `docs/performance-report.md`
- [ ] T148 [P] Performance validation against SC-004 (report under 30 s at 5 k appointments) already covered by T137; record numbers
- [ ] T149 [P] Security review on all Route Handlers: verify every handler calls `require-role` or is explicitly public (webhook, worker); grep for direct `supabase-service.ts` imports outside allowed paths; run `/security-review` skill on diff
- [ ] T150 [P] Verify SC-011 — automated scan of `patients` row to confirm `*_enc` columns are bytea and never contain plaintext patterns (test `tests/integration/patient-encryption.spec.ts`)
- [ ] T151 [P] Verify SC-013 — run the full test suite with Resend client captured; assert no captured e-mail body contains any PII tokens from a known seeded patient
- [ ] T152 [P] Document the charlesfgarcia/tabelas-ans license verification result in `docs/data-sources.md` and flip the production seed flag once approved by legal (resolves the R5 follow-up TODO from `plan.md`)
- [ ] T153 [P] Write `docs/operations.md` covering: on-call playbook for DLQ spikes, rotation of webhook secrets, TUSS catalog update procedure, alert-triage workflow
- [ ] T154 [P] Write `docs/lgpd.md` describing patient-data retention policy, anonymization procedure, and audit-log retention (deferred item from research.md)
- [ ] T171 Implement `src/lib/core/patients/anonymize.ts` — replaces `full_name_enc`, `cpf_enc`, `phone_enc`, `email_enc`, `birth_date_enc` with deterministic tokens (e.g., `enc_text('ANONYMIZED:'||patient_id)`), sets `anonymized_at=now()`, records an `audit_log` row with `result='success'`, `reason='lgpd-retention-anonymization'`, and `actor_label='platform-operator'`; atendimentos permanecem vinculados ao mesmo `patient_id` (implementa FR-010c)
- [ ] T172 [P] Implement platform-operator-only endpoint `src/app/api/platform/patients/[id]/anonymize/route.ts` — guard: requires request header `X-Platform-Operator-Token` matching env `PLATFORM_OPERATOR_TOKEN`; any tenant user receives 403; calls T171
- [ ] T173 [P] Integration test `tests/integration/patient-anonymize-preserves-appointments.spec.ts` — seeds patient with 3 atendimentos; invokes anonymize; asserts (a) patient row decrypted fields return the anonymization token, (b) each atendimento still references the same `patient_id` with unchanged `frozen_amount_cents`, (c) `appointments_effective` view still computes correct net values, (d) `audit_log` contains the expected anonymization row
- [ ] T155 Run the full constitution compliance suite (T057–T060) one more time against the production-like config (Supabase Pro staging); all must pass
- [ ] T156 Run `quickstart.md` end-to-end on a clean machine; record any drift and update the doc
- [ ] T157 [P] Provision production infra: Supabase project in sa-east-1, Vercel project linked to repo with region `gru1`, QStash queue in sa-east-1, Resend domain verified — checklist completion documented in `docs/deploy.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup (T001–T012)**: no dependencies; start immediately.
- **Phase 2 Foundational (T013–T060)**: depends on Setup. **Blocks all user story work.**
  - Within Phase 2: migrations T013–T023 must complete before trigger migrations T024–T027, which must complete before RLS migrations T028–T030. Seed T031–T032 depends on schema being applied. Clients and helpers T033–T048 can run in parallel with seeds. Constitution tests T057–T060 depend on the full schema + RLS being in place.
- **User Stories (Phases 3–6)**: all depend on Phase 2 completion.
  - **US1 (Phase 3)** is the MVP.
  - **US2 (Phase 4)** independent of US1 functionally but uses the same `price_versions` schema that US1 also reads. Tests depend on Phase 2 only.
  - **US3 (Phase 5)** similarly independent.
  - **US4 (Phase 6)** depends on having data to aggregate — in production it consumes data produced by US1/US2/US3, but test fixtures (T132+) seed the needed rows, so the phase can be developed in parallel once Phase 2 is done.
- **Phase 7 Polish (T145–T157)**: depends on all desired user stories being complete.

### User Story Dependencies

- **US1 (P1 — MVP)**: depends only on Foundational.
- **US2 (P2)**: depends only on Foundational.
- **US3 (P2)**: depends only on Foundational.
- **US4 (P3)**: depends only on Foundational for its own tests; in production operation it consumes data from US1/US2/US3, but the code surface is orthogonal and can be built in parallel.

### Within Each User Story

- Tests (T061–T075, T100–T107, T117–T122, T131–T138) MUST be written and MUST fail before their corresponding implementation is written.
- Domain/core modules before API Route Handlers.
- API Route Handlers before UI pages that consume them.
- Observability wiring (trace_id threading) after core modules are in place.

### Parallel Opportunities

- All tasks tagged `[P]` in a single phase can run on different files concurrently.
- Inside Phase 2, migrations T014–T023 are parallelizable in authorship (single author completes them) because they target different files; they apply sequentially at runtime.
- Inside each user story, all test tasks can be authored in parallel and will all fail initially; then implementation tasks also have many `[P]` subsets.
- With multiple developers, US1/US2/US3/US4 can be worked in parallel once Phase 2 is green.

---

## Parallel Example: User Story 1

```bash
# Tests — authored in parallel, all start red
Task: "Contract test webhook-ghl in tests/contract/webhook-ghl.spec.ts"
Task: "Integration test webhook-happy-path in tests/integration/webhook-happy-path.spec.ts"
Task: "Integration test webhook-idempotency in tests/integration/webhook-idempotency.spec.ts"
Task: "Integration test webhook-missing-field in tests/integration/webhook-missing-field.spec.ts"
Task: "Integration test webhook-no-price in tests/integration/webhook-no-price.spec.ts"
Task: "Integration test appointment-price-snapshot in tests/integration/appointment-price-snapshot.spec.ts"

# Domain — parallelizable
Task: "Implement verify-signature in src/lib/integrations/ghl/verify-signature.ts"
Task: "Implement extract-custom-fields in src/lib/integrations/ghl/extract-custom-fields.ts"
Task: "Implement ingest-raw-event in src/lib/core/webhooks/ingest-raw-event.ts"

# Sequential block (each depends on prior core work)
Task: "Implement resolve-price in src/lib/core/pricing/resolve-price.ts"
Task: "Implement resolve-commission in src/lib/core/commissions/resolve-commission.ts"
Task: "Implement upsert-from-ghl in src/lib/core/patients/upsert-from-ghl.ts"
Task: "Implement create-from-event in src/lib/core/appointments/create-from-event.ts"
Task: "Implement process-event in src/lib/core/webhooks/process-event.ts"
Task: "Implement webhook route handler in src/app/api/webhooks/ghl/route.ts"
Task: "Implement worker route handler in src/app/api/workers/process-ghl-event/route.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Complete Phase 1 Setup (T001–T012).
2. Complete Phase 2 Foundational in order: schema → triggers → RLS → seed → clients/helpers → alert dispatcher → constitution tests (T057–T060 green). **Critical — blocks everything.**
3. Complete Phase 3 US1 (T061–T099): tests red first, then domain, then API, then UI, finally observability wiring.
4. **STOP and VALIDATE**: run the `quickstart.md` Section 5 flow + `tests/integration/webhook-*` + `tests/integration/reversal-*` suites.
5. Demo MVP to stakeholders.

### Incremental Delivery

1. After MVP: add US2 (price management UI) → test → deploy → demo.
2. Then US3 (doctor management) → test → deploy → demo.
3. Then US4 (monthly report + export) → test → deploy → demo.
4. Finally Phase 7 Polish: performance validation, security review, LGPD documentation, production provisioning.

### Parallel Team Strategy

With 3 developers after Phase 2 completes:

- Dev A: US1 (Phase 3) — pairs with the spec owner because it drives product value.
- Dev B: US2 (Phase 4).
- Dev C: US3 (Phase 5).
- Once any two of US1/US2/US3 are green, one developer picks up US4 (Phase 6).
- Pair review is mandatory on any PR touching `src/lib/core/` or `supabase/migrations/` per constitution Section 3.

---

## Notes

- `[P]` tasks target different files and have no unresolved dependencies on incomplete tasks in the same phase.
- `[Story]` label maps each task to a user story for traceability; Setup/Foundational/Polish have no label.
- Each user story is independently completable and testable against the acceptance scenarios in `spec.md`.
- Verify tests fail before implementing, per constitution.
- Commit after each task or logical group; honor the `before_*` and `after_*` git hooks registered in `.specify/extensions.yml`.
- Stop at any checkpoint to validate the story independently.
- Avoid: tasks that touch the same file in parallel; cross-story implementation dependencies that break independence; skipping the constitution-level tests in Phase 2.

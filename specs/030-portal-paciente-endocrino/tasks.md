---
description: "Task list — Portal do Paciente + Módulo de Endocrinologia (feature 030)"
---

# Tasks: Portal do Paciente + Módulo de Endocrinologia

**Input**: Design documents from `/specs/030-portal-paciente-endocrino/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: INCLUÍDOS — a Constituição (Quality Gates) obriga testes de isolamento multi-tenant, append-only e RBAC; e a segurança do login (auth fraca CPF+nascimento) exige testes de rate-limit + mensagem genérica.

**Organization**: por user story, em ordem de entrega MVP: Setup → Foundational → US1 → US2 → US3 → Polish. **MVP = Foundational + US1 + US2.**

## Format: `[ID] [P?] [Story?] Description`
- **[P]** = paralelizável (arquivos distintos, sem dependência pendente). Caminhos a partir de `C:\My project\`.

---

## Phase 1: Setup

- [ ] T001 [P] Definir o env `PATIENT_SESSION_SECRET` (segredo forte, só servidor) em `.env.local` e documentar em `.env.example`/README; é a chave HMAC do cookie de sessão do paciente.
- [ ] T002 [P] Criar a estrutura da cápsula `src/lib/core/patient-portal/` (arquivos vazios: `session.ts`, `login.ts`, `measurements.ts`, `read-portal.ts`, `audit.ts`, `metric-types.ts`).

**Checkpoint**: env + esqueleto da cápsula prontos.

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: nenhuma user story começa antes desta fase.

- [ ] T003 Criar migration `supabase/migrations/0113_patient_portal_measurements.sql` com as tabelas `patient_measurements` (append-only), `patient_metric_types` (catálogo) e `patient_portal_access_log` (append-only), conforme data-model.md (PKs UUID, `tenant_id` onde aplicável).
- [ ] T004 Na mesma migration: RLS (leitura staff por tenant; escrita de medições `admin`/`profissional_saude`; `patient_metric_types` leitura para autenticado; `access_log` escrita só service-role), triggers `enforce_append_only_columns('')` (measurements/access_log) + `enforce_append_only` (metric_types), e trigger de coerência BEFORE INSERT em `patient_measurements` (metric_type existe + value na faixa plausível).
- [ ] T005 Na mesma migration: **seed** de `patient_metric_types` para endocrinologia (glicemia_jejum, hba1c, circunferencia_abdominal, colesterol_total, ldl, hdl, triglicerides) com unidade, faixas plausíveis e ordem. *(Faixas a revisar clinicamente — ver T031.)*
- [ ] T006 Na mesma migration: **ALTER** do CHECK de `public_booking_rate_limits.action` para incluir `'patient_login'` (preservando os valores existentes).
- [ ] T007 Na mesma migration: RPC `patient_portal_verify_login(p_slug, p_cpf, p_birthdate, p_key)` SECURITY DEFINER (resolve tenant por slug, acha paciente por CPF decifrando, confere nascimento só-dígitos, exclui anonimizado; grant só `service_role`).
- [ ] T008 Rodar `pnpm supabase:reset` + `pnpm supabase:gen-types`; conferir os novos tipos em `src/lib/db/generated/types.ts`.
- [ ] T009 [P] Implementar `src/lib/core/patient-portal/session.ts` — cookie HMAC `create/verify` (payload `{patientId,tenantId,iatMs,expMs}`, assina com `PATIENT_SESSION_SECRET`, `timingSafeEqual`), reusando o padrão de `src/lib/integrations/ghl/oauth/state.ts`.
- [ ] T010 [P] Implementar `src/lib/core/patient-portal/audit.ts` — `logPatientAccess` (insere em `patient_portal_access_log`, IP via `hashIpForTenant`).
- [ ] T011 [P] Implementar `src/lib/core/patient-portal/metric-types.ts` — leitura tipada do catálogo `patient_metric_types` (lista por especialidade, lookup, faixas).
- [ ] T012 Exemptar `/paciente` do middleware de staff em `src/middleware.ts` (mesmo bloco de `/agendar`).
- [ ] T013 [P] Contract test `tests/contract/patient-measurements-append-only.spec.ts` — `DELETE`/`UPDATE` bloqueados em `patient_measurements`; coerência (tipo inválido / fora de faixa) rejeitada.
- [ ] T014 [P] Contract test `tests/contract/patient-measurements-rbac.spec.ts` — `recepcionista`/`financeiro` não inserem medição; `admin`/`profissional_saude` inserem.

**Checkpoint**: schema aplicado, sessão+auditoria prontas, middleware liberado, testes de contrato base verdes.

---

## Phase 3: User Story 1 — Paciente entra e vê sua evolução (Priority: P1) 🎯 MVP

**Goal**: paciente faz login (CPF+nascimento) e vê o painel (evolução de peso/IMC + métricas metabólicas), só leitura, só do próprio.

**Independent Test**: com paciente que tem medições, logar e ver os gráficos só dele; nascimento errado → negado genérico; tentativas repetidas → bloqueado.

### Tests for US1 ⚠️
- [ ] T015 [P] [US1] Contract test `tests/contract/patient-portal-login.spec.ts` — nascimento errado → 401 genérico; CPF inexistente → mesma resposta; após N falhas → 429 (rate-limit).
- [ ] T016 [P] [US1] Contract test `tests/contract/patient-portal-isolation.spec.ts` — sessão do paciente A não lê dados do paciente B nem de outra clínica; endpoint ignora patient_id/tenant_id vindos do cliente.
- [ ] T017 [P] [US1] Integration test `tests/integration/patient-portal-login-and-read.spec.ts` — login OK → `GET /api/paciente/dados` traz evolução de peso/IMC + métricas do próprio paciente.

### Implementation for US1
- [ ] T018 [US1] `src/lib/core/patient-portal/login.ts` — `verifyPatientLogin` (rate-limit check/bump por IP×slug e CPF×slug; chama `patient_portal_verify_login`; audita login_ok/fail; retorna patient/tenant ou falha genérica). (depende T007, T009, T010)
- [ ] T019 [P] [US1] `src/lib/core/patient-portal/measurements.ts` — `listMeasurements({tenantId,patientId})` agrupado por `metric_type` (leitura escopada).
- [ ] T020 [US1] `src/lib/core/patient-portal/read-portal.ts` — `buildPatientPortalBundle` (une `listVitalSigns` peso/IMC + `listMeasurements` + nome via `get_patient_for_tenant`), escopado a patient_id+tenant_id da sessão. (depende T019)
- [ ] T021 [US1] Route `src/app/api/paciente/login/route.ts` (POST, rate-limit + set cookie) + `logout/route.ts` (POST). (depende T018)
- [ ] T022 [US1] Route `src/app/api/paciente/dados/route.ts` (GET) — verifica cookie (senão 401), deriva patient_id/tenant_id **só do cookie**, retorna o bundle + audita `view`. (depende T020, T009)
- [ ] T023 [P] [US1] Extrair o gráfico de evolução de `operacao/pacientes/[id]/vital-signs-section.tsx` para um componente reutilizável só-leitura (sem formulário) p/ o portal.
- [ ] T024 [US1] UI `src/app/paciente/[slug]/page.tsx` — login (CPF + nascimento) + consentimento LGPD; resolve a clínica pelo slug (`public_booking_resolve_slug`).
- [ ] T025 [US1] UI `src/app/paciente/[slug]/painel/page.tsx` — painel só-leitura: evolução de peso/IMC + gráficos das métricas metabólicas; estados vazios amigáveis; exige sessão (senão volta ao login). (depende T022, T023)

**Checkpoint**: paciente loga e vê a própria evolução (com dados já existentes de peso/IMC). MVP parcial.

---

## Phase 4: User Story 2 — Equipe registra as métricas metabólicas (Priority: P1) 🎯 MVP

**Goal**: profissional registra glicemia/HbA1c/circunferência/lipídios no prontuário; valores passam a aparecer no portal.

**Independent Test**: registrar HbA1c em duas datas e ver no painel do paciente; valor fora de faixa bloqueia; recepcionista não registra.

### Tests for US2 ⚠️
- [ ] T026 [P] [US2] Integration test `tests/integration/staff-record-metabolic-metric.spec.ts` — profissional registra métrica → aparece no bundle do paciente; valor implausível → 422; recepcionista → 403.

### Implementation for US2
- [ ] T027 [US2] Estender `src/lib/core/patient-portal/measurements.ts` com `recordMeasurement` (valida tipo+faixa via catálogo, insere append-only, `log_audit_event`).
- [ ] T028 [US2] Route `src/app/api/pacientes/[id]/medicoes/route.ts` (POST) — `requireRole(['admin','profissional_saude'])`; 422 com mensagem clara em valor inválido. (depende T027)
- [ ] T029 [P] [US2] UI `src/app/(dashboard)/operacao/pacientes/[id]/metabolic-metrics-section.tsx` — seção no prontuário p/ registrar as métricas (reusa o padrão de `vital-signs-section.tsx`).
- [ ] T030 [US2] Inserir a seção no prontuário do paciente (montagem da página de paciente) para a equipe acessar.

**Checkpoint**: **MVP completo (Foundational+US1+US2)** — equipe registra métricas e o paciente as vê evoluir.

---

## Phase 5: User Story 3 — Histórico de atendimentos no portal (Priority: P2)

**Goal**: paciente vê a lista dos próprios atendimentos (data, profissional), sem financeiro.

**Independent Test**: paciente com 3 atendimentos vê os 3, em ordem, só os dele, sem valores financeiros.

### Tests for US3 ⚠️
- [ ] T031 [P] [US3] Integration test `tests/integration/patient-portal-appointments.spec.ts` — bundle traz os atendimentos do paciente (data/profissional), sem campos financeiros; só do próprio paciente.

### Implementation for US3
- [ ] T032 [US3] Estender `read-portal.ts` com a leitura dos atendimentos do paciente (data, profissional, tipo/resumo), **omitindo** valores financeiros. (depende T020)
- [ ] T033 [US3] Exibir a seção "Meus atendimentos" no painel `paciente/[slug]/painel/page.tsx`.

**Checkpoint**: portal com evolução + histórico.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T034 [P] **Revisão clínica das faixas plausíveis** das métricas (T005) com referência (SBD/Min. Saúde) antes de produção.
- [ ] T035 [P] Tratamento de **CPF duplicado** na mesma clínica no login (bloquear acesso ambíguo + sinalizar à clínica), conforme edge case do spec.
- [ ] T036 [P] UX: expiração de sessão (mensagem + volta ao login), responsivido/acessibilidade do portal, estados vazios.
- [ ] T037 Revisão de segurança: confirmar que nenhum endpoint do portal aceita patient_id/tenant_id do cliente; mensagens de login genéricas; IP só como hash; nenhum dado financeiro/de terceiro vaza (grep + testes).
- [ ] T038 [P] Rodar `pnpm typecheck`, `pnpm lint:auth` e a suíte (`pnpm test`); validar `quickstart.md` ponta a ponta.

---

## Dependencies & Execution Order

- **Setup (P1)** → **Foundational (P2, bloqueia tudo)** → user stories.
- **US1 (P1)** depende da Foundational; **US2 (P1)** depende da Foundational e do `measurements.ts` (criado na US1, estendido na US2). MVP = Foundational+US1+US2.
- **US3 (P2)** depende do `read-portal.ts` (US1).
- Dentro de cada story: testes → core (services) → routes → UI.

### Parallel Opportunities
- Setup: T001, T002 em paralelo.
- Foundational: T009/T010/T011 em paralelo; T013/T014 (testes) em paralelo após o schema (T008).
- US1: T015/T016/T017 (testes) em paralelo; T019/T023 em paralelo.
- Stories diferentes por devs distintos após a Foundational.

---

## Implementation Strategy

### MVP First
1. Setup → 2. Foundational → 3. US1 (login + painel) → 4. US2 (entrada de métricas) → **STOP e validar** o ciclo: equipe registra → paciente vê. Demo.

### Incremental
US3 (histórico) → Polish (segurança, faixas clínicas, CPF duplicado, responsivo).

### Notas
- **Não rodar `vitest` durante teste manual** (apaga o banco local; re-seed `pnpm seed:demo`).
- Produção: migration via `supabase db push`; **migração é 0113** (0112 reservada pelo TISS/029).
- Toda leitura do portal deriva identidade **só do cookie HMAC verificado** — nunca do cliente.
- Commit por tarefa ou grupo lógico.

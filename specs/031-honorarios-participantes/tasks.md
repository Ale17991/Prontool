---
description: "Task list — Honorários e participantes (equipe) por procedimento (feature 031)"
---

# Tasks: Honorários e participantes (equipe) por procedimento

**Input**: Design documents from `/specs/031-honorarios-participantes/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: INCLUÍDOS — a Constituição (Seção 3/Quality Gates) **obriga** testes de contrato de imutabilidade/append-only, isolamento multi-tenant e RBAC para features financeiras/multi-tenant, além do teste-âncora XML×XSD (TISS).

**Organization**: por user story, em ordem de prioridade. MVP = US1.

## Format: `[ID] [P?] [Story] Description`
- **[P]** = paralelizável (arquivos distintos, sem dependência pendente).
- Caminhos absolutos a partir da raiz do repo `C:\My project\`.

---

## Phase 1: Setup

- [X] T001 Confirmar branch `031-honorarios-participantes` e numeração de migration livre (`0128`); conferir que 0126/0127 já estão em master (sem colisão).

**Checkpoint**: ambiente pronto para a fundação.

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: nenhuma user story começa antes desta fase.

- [X] T002 Criar migration `supabase/migrations/0128_procedure_participants.sql`: `ALTER appointment_assistants ADD procedure_id UUID NULL REFERENCES appointment_procedures(id)` + `participation_degree TEXT NULL`; índice `appointment_assistants_procedure_idx`.
- [X] T003 Na mesma migration: substituir a unique ativa por `UNIQUE (appointment_id, procedure_id, assistant_doctor_id) WHERE removed_at IS NULL` (DROP do índice `appointment_assistants_no_duplicate_active_idx`).
- [X] T004 Na mesma migration: relaxar o trigger liberal-only (trigger 3 da 0084) — `CREATE OR REPLACE` para aceitar qualquer `payment_mode` de médico ATIVO do mesmo tenant; estender `enforce_appointment_assistants_mutation` (procedure_id/participation_degree imutáveis pós-INSERT) e `check_assistant_tenant_consistency` (procedure_id pertence ao appointment/tenant). `NOTIFY pgrst`.
- [X] T005 Aplicar a migration em dev (`pnpm supabase:reset`), `pnpm supabase:gen-types`, re-seed (`pnpm seed:demo` + `pnpm seed:tiss-domains`); confirmar `pnpm typecheck` verde e domínio 35 presente em `tiss_domain_tables`.
- [X] T006 Estender o RPC de vínculo (`attach_assistant_to_appointment` / `remove_appointment_assistant`, migrations 0084/0085) — ou nova RPC SECURITY DEFINER — para aceitar `p_procedure_id` e `p_participation_degree`, sem a restrição de modalidade. Atualizar via migration 0128.
- [X] T007 [P] Core `src/lib/core/tiss/domains.ts` já lê domínios — adicionar helper de validação/listagem do domínio `35` (grau de participação) se ainda não exposto, reusando `listDomain`/`isValidDomainCode`.

**Checkpoint**: schema estendido, RPC pronta, domínio 35 disponível. User stories podem começar.

---

## Phase 3: User Story 1 — Cadastrar a equipe de um procedimento (Priority: P1) 🎯 MVP

**Goal**: registrar/remover participantes por linha de procedimento, com grau (dom. 35) e honorário congelado, qualquer modalidade.

**Independent Test**: adicionar 2 participantes (modalidades distintas) a um procedimento, recarregar e ver persistido; duplicar o mesmo médico no mesmo procedimento é bloqueado; remover sai da lista ativa mantendo histórico.

### Tests for US1 ⚠️
- [X] T008 [P] [US1] Contract test `tests/contract/procedure-participants-append-only.spec.ts` — UPDATE de `procedure_id`/`participation_degree`/`frozen_amount_cents` bloqueado; DELETE bloqueado; só `removed_at`/`removed_by` mudam.
- [X] T009 [P] [US1] Contract test `tests/contract/procedure-participants-tenant-isolation.spec.ts` — participante/procedimento de outro tenant barrado (RLS + trigger de consistência).
- [X] T010 [P] [US1] Contract test `tests/contract/procedure-participants-rbac.spec.ts` — POST/DELETE exigem `admin`/`financeiro`; `recepcionista`/`profissional_saude` recebem 403 (negação logada).
- [X] T011 [P] [US1] Integration test `tests/integration/procedure-participants-crud.spec.ts` — 2 participantes (fixo + comissionado) num procedimento; duplicado bloqueado; remoção soft-unlink; grau fora do domínio 35 rejeitado; honorário ≤ 0 rejeitado.

### Implementation for US1
- [X] T012 [US1] Estender `src/lib/core/appointment-assistants/` (attach/remove) para `procedure_id` + `participation_degree` + validação de grau (domínio 35), duplicidade por (appointment, procedure, doctor) e honorário > 0.
- [X] T013 [US1] Estender `src/lib/core/appointment-assistants/list-by-appointment.ts` para retornar participantes agrupados por `procedure_id` com `degreeLabel` (de `tiss_domain_tables` 35).
- [X] T014 [US1] Route `src/app/api/atendimentos/[id]/participantes/route.ts` (POST) com `requireRole(['admin','financeiro'])` + Zod (`procedureId`,`doctorId`,`participationDegree`,`amountCents`).
- [X] T015 [US1] Route `src/app/api/atendimentos/[id]/participantes/[participantId]/route.ts` (DELETE) — soft-unlink, `requireRole(['admin','financeiro'])`.
- [X] T016 [US1] Incluir participantes por procedimento no payload de detalhe do atendimento (RSC/route que alimenta `AppointmentDetailBody`).
- [X] T017 [US1] UI: componente de equipe por procedimento em `src/app/(dashboard)/operacao/atendimentos/_components/` (adicionar/remover; seletor de profissional + grau do domínio 35 + honorário), respeitando `finance.view_values`. Integrar no `appointment-detail-body.tsx` por linha de procedimento.

**Checkpoint**: equipe por procedimento gerenciável ponta a ponta (MVP).

---

## Phase 4: User Story 2 — Honorário entra no repasse (Priority: P2)

**Goal**: o honorário de cada participação soma no repasse do profissional, qualquer modalidade; sai no estorno.

**Independent Test**: registrar participações no mês para um médico, abrir o repasse e ver a soma na linha dele; estornar o atendimento e ver sair.

### Tests for US2 ⚠️
- [X] T018 [P] [US2] Integration test `tests/integration/participant-feeds-repasse.spec.ts` — participações de fixo e comissionado entram no repasse do mês (mês aberto via `getMonthlyPayoutSnapshot`); atendimento estornado não conta.
- [X] T019 [P] [US2] Integration test `tests/integration/participant-repasse-close.spec.ts` — fechamento (`close_monthly_payout`/0126) grava o honorário em `liberal_payment_cents` para qualquer modalidade.

### Implementation for US2
- [X] T020 [US2] Verificar/ajustar `src/lib/core/monthly-payouts/index.ts` (`aggregateLiberalByDoctor`) — confirmar que soma qualquer modalidade após o relaxe do trigger (sem filtro de modalidade); ajustar comentários.
- [X] T021 [US2] Renomear o **rótulo** de apresentação "Liberal" → "Participações/Honorários" em `src/app/(dashboard)/analise/repasse-medico/[mes]/payouts-view.tsx` (coluna), sem alterar a coluna `liberal_payment_cents` nem o cálculo.

**Checkpoint**: repasse reflete os honorários de participação, qualquer modalidade.

---

## Phase 5: User Story 3 — Equipe na guia TISS SP/SADT (Priority: P2)

**Goal**: a guia SP/SADT inclui o bloco `equipeSadt` por procedimento com os participantes e graus, válido no XSD.

**Independent Test**: gerar SP/SADT de um atendimento com participantes → guia com `equipeSadt` válida; participante incompleto → `rascunho` com pendência.

### Tests for US3 ⚠️
- [ ] T022 [P] [US3] Teste-âncora `tests/contract/tiss-render-spsadt-equipe-validates.spec.ts` — `render-spsadt` com `equipeSadt` (1–2 membros) valida no XSD 04.03.00 (xmllint-wasm).
- [ ] T023 [P] [US3] Integration test `tests/integration/tiss-spsadt-equipe.spec.ts` — atendimento com 2 participantes num procedimento → guia `pronta` com 2 membros na equipe; remover CBO de um → `rascunho` com `validation_errors` apontando o participante.

### Implementation for US3
- [ ] T024 [US3] Estender `src/lib/core/tiss/xml/render-spsadt.ts` — adicionar `equipeSadt` (repetível) por `procedimentoExecutado` na ordem do XSD (`ct_identEquipeSADT`: grauPart, codProfissional/cpfContratado, nomeProf, conselho, numeroConselho, UF, CBOS).
- [ ] T025 [US3] Estender `src/lib/core/tiss/build-guia.ts` (`generateSpSadtGuia`) — carregar participantes ativos por linha de procedimento e mapear para `equipeSadt` (CPF/conselho/UF/CBO do `doctors` + grau).
- [ ] T026 [US3] Estender `src/lib/core/tiss/xml/validate-content.ts` — pendência quando participante sem CPF/conselho/UF/CBO completos (guia não fica `pronta`).

**Checkpoint**: faturamento TISS de procedimentos com equipe completo.

---

## Phase 6: User Story 4 — Corrigir a equipe sem perder histórico (Priority: P3)

**Goal**: correção via remoção + novo registro; auditoria preserva ambos.

**Independent Test**: registrar com valor errado, remover, registrar o correto; financeiro usa o novo e a auditoria mostra as duas operações.

### Tests for US4 ⚠️
- [ ] T027 [P] [US4] Integration test `tests/integration/participant-correction-audit.spec.ts` — remoção + novo registro: repasse passa a usar o novo; `audit_log` contém inclusão e remoção (ator/timestamp/valores).

### Implementation for US4
- [ ] T028 [US4] Garantir auditoria (`log_audit_event`) na inclusão e na remoção (na RPC/core de T006/T012) com ator, valores e motivo; expor a remoção na UI (T017) com confirmação.

**Checkpoint**: ciclo de correção auditável.

---

## Phase 7: Polish & Cross-Cutting

- [ ] T029 [P] Atualizar `CLAUDE.md`/agent context com a feature (equipe por procedimento; domínio 35; reuso do repasse).
- [ ] T030 [P] Rodar `pnpm typecheck`, `pnpm lint`, `pnpm lint:auth`; suíte dos specs novos verde; re-seed (`pnpm seed:demo`).
- [ ] T031 Validar `quickstart.md` ponta a ponta (US1→US4) em dev.

---

## Dependencies & Execution Order

- **Setup (Phase 1)** → **Foundational (Phase 2, bloqueia tudo)** → user stories.
- **US1 (P1)** = MVP. **US2/US3/US4** dependem da Foundational e do registro de participantes (US1) para terem dados, mas são fatias independentes de teste.
- US3 depende também do módulo TISS SP/SADT já existente (feature 029).
- Dentro de cada story: testes → core → rotas → UI.

### Parallel Opportunities
- Foundational: T007 em paralelo após o schema.
- US1: T008–T011 (testes) em paralelo; depois T012/T013 (core) antes de rotas/UI.
- US2 e US3 podem ser tocadas por devs distintos após a Foundational + US1.

---

## Implementation Strategy

### MVP First
1. Phase 1 (Setup) → 2. Phase 2 (Foundational) → 3. US1 → **STOP e validar** (cadastrar/remover equipe por procedimento). Demo.

### Incremental
US2 (repasse) → US3 (TISS equipe) → US4 (correção), cada um testável e entregável sem quebrar o anterior.

### Notas
- **Não rodar `vitest` durante teste manual** (apaga o banco local; re-seed `pnpm seed:demo`).
- Produção: migration via `supabase db push` (nunca `db reset --linked`).
- Append-only e RBAC são gates de constituição — não pular os testes T008–T010.
- Commit por tarefa ou grupo lógico.

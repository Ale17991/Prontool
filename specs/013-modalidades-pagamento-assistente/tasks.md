---

description: "Tasks for feature 013 — Modalidades de pagamento + Profissional assistente"
---

# Tasks: Modalidades de pagamento + Profissional assistente

**Input**: Design documents from `/specs/013-modalidades-pagamento-assistente/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md
**Tests**: INCLUDED — exigidos pela Constitution (§"Testes obrigatórios" para preços/faturas, multi-tenant e RBAC) e por FR-008, FR-014, FR-015, FR-018, FR-019, FR-020, FR-027 da spec.

**Organization**: Tarefas agrupadas por user story (US1, US2, US3) para entrega incremental. US1 é o foundational do domínio; US2 e US3 dependem de US1 entregue, mas são paralelizáveis entre si.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Pode rodar em paralelo (arquivos distintos, sem dependência em tarefa incompleta)
- **[Story]**: Mapeia para a US — [US1] cadastro de modalidades, [US2] assistentes em atendimento, [US3] impacto nos relatórios
- Caminhos a partir da raiz do repo (`C:\My project\...`)

## Path Conventions

App Router monolítico (Next.js 14). Mapa rápido:
- DB: `supabase/migrations/`
- Core libs: `src/lib/core/<dominio>/`
- RBAC: `src/lib/auth/rbac.ts`
- API: `src/app/api/<recurso>/route.ts`
- UI: `src/app/(dashboard)/...`
- Testes: `tests/contract/`, `tests/integration/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Pré-requisitos sem amarra a uma US específica.

- [X] T001 [P] Confirmar que `pnpm supabase:reset` e `pnpm supabase:gen-types` rodam sem erro contra stack local (`supabase start`) — `specs/013-modalidades-pagamento-assistente/quickstart.md > Setup local`
- [X] T002 [P] Conferir branch `013-modalidades-pagamento-assistente` rebased sobre `master` e `.specify/feature.json` apontando para `specs/013-modalidades-pagamento-assistente`

**Checkpoint**: ambiente local pronto para receber a migration.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: schema novo (1 migration), RBAC novo, helpers compartilhados. **Bloqueia US1–US3** — todas dependem da migration 0084 e dos tipos regenerados.

**⚠️ CRITICAL**: Não iniciar Phase 3–5 antes do checkpoint desta fase.

### Database schema (single migration)

- [X] T003 Criar migration `supabase/migrations/0084_payment_modes_and_assistants.sql` contendo: (a) ENUM `public.payment_mode`; (b) ALTER `doctors` ADD `payment_mode payment_mode NOT NULL DEFAULT 'comissionado'` + índice `doctors_payment_mode_idx`; (c) tabela `doctor_payment_terms_history` com CHECK por modalidade, UNIQUE `(tenant_id, doctor_id, valid_from)`, índice de lookup, RLS `payment_terms_read_tenant`, REVOKE INSERT/UPDATE/DELETE de authenticated; (d) tabela `appointment_assistants` com unique parcial `(appointment_id, assistant_doctor_id) WHERE removed_at IS NULL`, CHECK `removed_pair_complete`, RLS `assistants_read_tenant`; (e) triggers `enforce_payment_terms_immutable`, `audit_payment_terms_insert`, `enforce_appointment_assistants_mutation`, `check_assistant_tenant_consistency`, `check_assistant_doctor_is_liberal`, `audit_appointment_assistant_change`, `audit_doctors_payment_mode_change`; (f) view `doctor_payment_terms_current` (DISTINCT ON head-of-chain); (g) view `monthly_fixed_pay_lines` (generate_series virtualizado); (h) RPCs `record_payment_terms_change`, `attach_assistant_to_appointment`, `remove_appointment_assistant` (SECURITY DEFINER com guards de tenant/role); (i) backfill seed 1 row por doctor existente em `doctor_payment_terms_history` lendo head-of-chain de `doctor_commission_history`; (j) `NOTIFY pgrst, 'reload schema'` ao final. Referência completa: `specs/013-modalidades-pagamento-assistente/data-model.md`
- [X] T004 Aplicar migration localmente via `pnpm supabase:reset` e regenerar types com `pnpm supabase:gen-types` — verificar que `src/lib/db/types.ts` ganha `payment_mode` enum + `doctor_payment_terms_history` + `appointment_assistants` + views novas
- [X] T005 [P] Adicionar actions RBAC novas em `src/lib/auth/rbac.ts`: `doctor.payment_mode.write` (admin), `doctor.payment_terms.read` (admin, financeiro), `appointment.assistant.write` (admin, recepcionista). Atualizar a matriz de papéis + exportar tipos
- [X] T006 [P] Criar arquivo de types compartilhados `src/lib/core/payment-terms/types.ts` exportando `PaymentMode` (literal union), `PaymentTermsRow`, `PaymentTermsCurrent`, `RecordPaymentTermsChangeInput`

### Contract tests da Phase 2 (validam o schema independente das USs)

- [X] T007 [P] Contract test trigger append-only `doctor_payment_terms_history` (UPDATE/DELETE bloqueados pra authenticated; service_role passa) em `tests/contract/payment-terms-immutability.spec.ts`
- [X] T008 [P] Contract test isolamento tenant `doctor_payment_terms_history` (RLS bloqueia leitura cross-tenant; UNIQUE NÃO permite duplicar `(tenant_id, doctor_id, valid_from)`) em `tests/contract/payment-terms-tenant-isolation.spec.ts`
- [X] T009 [P] Contract test trigger `enforce_appointment_assistants_mutation` — UPDATE só passa se mudar exclusivamente `removed_at`/`removed_by` de NULL para NOT NULL; demais UPDATEs/DELETEs rejeitados em `tests/contract/appointment-assistants-immutability.spec.ts`
- [X] T010 [P] Contract test isolamento tenant `appointment_assistants` (RLS + trigger tenant consistency) em `tests/contract/appointment-assistants-tenant-isolation.spec.ts`
- [X] T011 [P] Contract test trigger `check_assistant_doctor_is_liberal` — INSERT com doctor comissionado/fixo rejeitado com `ASSISTANT_NOT_LIBERAL` em `tests/contract/appointment-assistants-liberal-only.spec.ts`
- [X] T012 [P] Contract test backfill: cada doctor existente tem exatamente 1 row em `doctor_payment_terms_history` com `payment_mode='comissionado'` em `tests/contract/doctors-payment-mode-backfill.spec.ts`

**Checkpoint**: schema validado em isolamento (sem rotas/UI). Pode-se iniciar Phase 3 (US1) em paralelo com Phases 4/5 quando US1 entregar o core de doctors atualizado.

---

## Phase 3: User Story 1 — Cadastro de modalidades (Priority: P1) 🎯 MVP

**Goal**: Admin classifica cada profissional em Comissionado/Fixo/Liberal, com campos dinâmicos no cadastro, badge na listagem, histórico em audit. Profissionais legados ficam como Comissionado por default.

**Independent Test**: cadastrar 3 profissionais (1 por modalidade), editar 1 deles trocando modalidade, ver o histórico via `GET /api/medicos/[id]/payment-terms`, verificar audit log. Profissionais legados aparecem como Comissionado sem ação manual.

### Tests for User Story 1

- [X] T013 [P] [US1] Contract test RBAC: POST `/api/medicos` com `payment_mode` rejeita não-admin (403) e PATCH `payment_mode_change` exige admin em `tests/contract/api-medicos-payment-mode-rbac.spec.ts`
- [X] T014 [P] [US1] Integration test: criar 3 profissionais (comissionado/fixo/liberal) via POST `/api/medicos` — cada um persiste row em `doctor_payment_terms_history` + atualiza `doctors.payment_mode` em `tests/integration/doctor-create-with-payment-mode.spec.ts`
- [X] T015 [P] [US1] Integration test: mudar modalidade de um doctor comissionado para fixo via PATCH — nova versão em history (não retroativa), audit log com `field='version_created'`, `doctors.payment_mode` espelhado em `tests/integration/doctor-change-payment-mode-with-audit.spec.ts`

### Implementation for User Story 1

- [X] T016 [P] [US1] Implementar `resolveCurrentPaymentTerms(supabase, {tenantId, doctorId})` que faz SELECT em `doctor_payment_terms_current` em `src/lib/core/payment-terms/resolve-current.ts`
- [X] T017 [P] [US1] Implementar `listPaymentTermsHistory(supabase, {tenantId, doctorId})` retornando `{current, history[]}` em `src/lib/core/payment-terms/list-history.ts`
- [X] T018 [P] [US1] Implementar `updateDoctorPaymentMode(supabase, {tenantId, doctorId, newMode, params, validFrom, reason, actorUserId})` que invoca a RPC `record_payment_terms_change` em `src/lib/core/doctors/update-payment-mode.ts`
- [X] T019 [US1] Estender `createDoctor` em `src/lib/core/doctors/create.ts` para aceitar `paymentMode` + parâmetros + `validFrom` + `reason` e gravar tudo na mesma transação (RPC `record_payment_terms_change` + INSERT em `doctor_commission_history` se modo=comissionado). Depende de T018
- [X] T020 [US1] Estender `listDoctors` em `src/lib/core/doctors/list.ts` para fazer JOIN com `doctor_payment_terms_current` e retornar `paymentMode`, `currentPercentageBps`, `currentMonthlyAmountCents`, `currentBillingDay`, `currentLiberalDefaultCents`
- [X] T021 [US1] Estender `getDoctor` em `src/lib/core/doctors/get.ts` para incluir `paymentMode` + `currentPaymentTerms` + `paymentTermsHistoryCount`
- [X] T022 [US1] Atualizar schema Zod + handler `POST /api/medicos` em `src/app/api/medicos/route.ts` para aceitar `payment_mode` + bloco de parâmetros (refine cruzado por modalidade); herdar `requireRole(['admin'])`. Depende de T019
- [X] T023 [US1] Atualizar schema Zod + handler `PATCH /api/medicos/[id]` em `src/app/api/medicos/[id]/route.ts` para aceitar `payment_mode_change` (admin-only); `400 VALID_FROM_FUTURE` se data > hoje. Depende de T018
- [X] T024 [US1] Criar rota `GET /api/medicos/[id]/payment-terms` em `src/app/api/medicos/[id]/payment-terms/route.ts` (RBAC admin+financeiro) retornando `{current, history[]}`. Depende de T017
- [X] T025 [P] [US1] Atualizar `new-doctor-form.tsx` em `src/app/(dashboard)/configuracoes/profissionais/new-doctor-form.tsx`: seletor "Modalidade" + campos dinâmicos por modalidade (Comissionado: `Comissão %`; Fixo: `Valor mensal` + `Dia de faturamento 1-28`; Liberal: `Valor por participação`) + campo `reason` (≥3 chars)
- [X] T026 [P] [US1] Atualizar listagem em `src/app/(dashboard)/configuracoes/profissionais/page.tsx`: coluna "Modalidade" com badge colorido + coluna "Valor" adaptada (30% / R$ 8.000 / mês (dia 5) / R$ 350 / participação)
- [X] T027 [P] [US1] Criar `payment-mode-editor.tsx` em `src/app/(dashboard)/configuracoes/profissionais/[id]/payment-mode-editor.tsx` (client component, form admin-only para trocar modalidade com `reason`)
- [X] T028 [US1] Integrar `payment-mode-editor.tsx` + sidebar de histórico em `src/app/(dashboard)/configuracoes/profissionais/[id]/page.tsx` (consome GET `/api/medicos/[id]/payment-terms`). Depende de T024, T027

**Checkpoint**: US1 entregável em produção. Sistema reconhece 3 modalidades, profissionais legados ficam Comissionado, audit preservado. Pode-se iniciar US2 e US3 em paralelo.

---

## Phase 4: User Story 2 — Profissional assistente em atendimento (Priority: P2)

**Goal**: Recepcionista adiciona 1+ liberais como assistentes a um atendimento, com valor congelado por instância e soft-unlink. Visualização e calendário refletem.

**Independent Test**: criar atendimento com 2 assistentes liberais (1 com valor padrão, 1 editado), reabrir e ver lista preservada, calendário mostra "(+ 2 assistentes)", remover um → desaparece dos ativos mas auditoria registra. Estornar atendimento → registros preservados mas relatórios excluem.

### Tests for User Story 2

- [X] T029 [P] [US2] Contract test RBAC em `POST /api/atendimentos/[id]/assistants` e `PATCH /assistants/[assistantId]` — 403 para `profissional_saude` e `financeiro`; 200 para admin/recepcionista em `tests/contract/appointment-assistants-rbac.spec.ts`
- [X] T030 [P] [US2] Integration test: criar atendimento com 2 assistentes — POST `/api/atendimentos/manual` com `assistants[]` cria 2 rows + audit em `tests/integration/appointment-create-with-assistants.spec.ts`
- [X] T031 [P] [US2] Integration test: `frozen_amount_cents` congelado — após criar assistente com R$ 350, alterar `liberal_default_cents` do doctor para R$ 500; reabrir atendimento → ainda mostra R$ 350 em `tests/integration/assistant-frozen-value-preservation.spec.ts`
- [X] T032 [P] [US2] Integration test: soft-remove via PATCH — `removed_at` setado, GET atendimento não retorna mais em `assistants[]`, mas audit log registra em `tests/integration/appointment-assistant-soft-remove.spec.ts`
- [X] T033 [P] [US2] Integration test: atendimento estornado preserva registros mas relatório filtra — criar atendimento, adicionar assistente, estornar, verificar que `appointment_assistants` ainda tem a row mas `GET /api/relatorios/por-profissional/[liberalId]` retorna 0 em `tests/integration/appointment-reversal-with-assistants.spec.ts`
- [X] T034 [P] [US2] Integration test: Liberal NÃO pode ser principal — tentar criar atendimento com `doctor_id` de um Liberal retorna `400 LIBERAL_AS_PRINCIPAL` em `tests/integration/liberal-as-principal-blocked.spec.ts`

### Implementation for User Story 2

- [X] T035 [P] [US2] Implementar `addAssistant(supabase, {tenantId, appointmentId, assistantDoctorId, amountCents, actorUserId})` invocando RPC `attach_assistant_to_appointment` em `src/lib/core/appointment-assistants/add.ts`
- [X] T036 [P] [US2] Implementar `removeAssistant(supabase, {tenantId, assistantRowId, actorUserId})` invocando RPC `remove_appointment_assistant` em `src/lib/core/appointment-assistants/remove.ts`
- [X] T037 [P] [US2] Implementar `listAssistantsByAppointment(supabase, {tenantId, appointmentId})` retornando apenas `removed_at IS NULL` + contagem de removidos em `src/lib/core/appointment-assistants/list-by-appointment.ts`
- [X] T038 [P] [US2] Implementar `sumLiberalParticipationsByPeriod(supabase, {tenantId, doctorId, from, to})` somando `frozen_amount_cents WHERE removed_at IS NULL AND NOT EXISTS appointment_reversals` em `src/lib/core/appointment-assistants/sum-by-doctor-period.ts`
- [X] T039 [US2] Estender `createAppointmentManually` em `src/lib/core/appointments/create-manual.ts` para aceitar `assistants[]` e inserir cada um via RPC dentro da mesma transação. Depende de T035
- [X] T040 [US2] Adicionar validação `LIBERAL_AS_PRINCIPAL` em `createAppointmentManually` em `src/lib/core/appointments/create-manual.ts` — consulta `doctor_payment_terms_current` antes do INSERT
- [X] T041 [US2] Estender `getAppointment` em `src/lib/core/appointments/get.ts` para embedar `assistants[]` (ativos) + `removed_assistants_count`. Depende de T037
- [X] T042 [US2] Atualizar Zod + handler `POST /api/atendimentos/manual` em `src/app/api/atendimentos/manual/route.ts` para aceitar `assistants[]` + validações (`DUPLICATE_ASSISTANT`, `INVALID_ASSISTANT_AMOUNT`). Depende de T039
- [X] T043 [US2] Criar rota `POST /api/atendimentos/[id]/assistants` em `src/app/api/atendimentos/[id]/assistants/route.ts` (RBAC admin+recepcionista; 409 `APPOINTMENT_REVERSED` se atendimento estornado). Depende de T035
- [X] T044 [US2] Criar rota `PATCH /api/atendimentos/[id]/assistants/[assistantId]` em `src/app/api/atendimentos/[id]/assistants/[assistantId]/route.ts` (soft-remove; 409 `ASSISTANT_ALREADY_REMOVED`). Depende de T036
- [X] T045 [P] [US2] Criar `assistant-multi-select.tsx` (client component shadcn Command/Popover, filtra liberais, multi-select com valor editável por linha) em `src/app/(dashboard)/operacao/atendimentos/components/assistant-multi-select.tsx`
- [X] T046 [US2] Integrar `assistant-multi-select` no `new-appointment-form.tsx` em `src/app/(dashboard)/operacao/atendimentos/novo/new-appointment-form.tsx`; filtrar o seletor de "Profissional principal" para `payment_mode IN ('comissionado','fixo')`. Depende de T045
- [X] T047 [US2] Mostrar lista de assistentes ativos no detalhe do atendimento em `src/app/(dashboard)/operacao/atendimentos/[id]/page.tsx`. Depende de T041
- [X] T048 [P] [US2] Criar `assistants-editor.tsx` (client component para adicionar/remover assistente em atendimento já salvo) em `src/app/(dashboard)/operacao/atendimentos/[id]/assistants-editor.tsx`
- [X] T049 [P] [US2] Atualizar bloco do calendário em `src/app/(dashboard)/operacao/agenda/appointment-block.tsx` para exibir "(+ N assistentes)" abaixo do nome do profissional principal quando `assistants_count > 0`

**Checkpoint**: US2 entregável em produção. Sistema permite registrar assistentes liberais com valor congelado, soft-unlink auditado, UI completa.

---

## Phase 5: User Story 3 — Impacto nos relatórios (Priority: P3)

**Goal**: Relatório mensal lista pagamentos fixos no dia configurado; relatório por profissional tem shape diferente por modalidade; resultado operacional fecha a fórmula gross - comm - fixo - liberal - tax - expense = profit.

**Independent Test**: com 1 Fixo + 1 Liberal + 1 atendimento c/ assistente, abrir relatório mensal e ver linha fixa, abrir por-profissional dos 3 tipos e ver shapes corretos, abrir resultado-operacional e bater manualmente os números.

### Tests for User Story 3

- [X] T050 [P] [US3] Integration test: relatório mensal inclui `fixed_pay_lines` apenas DEPOIS do `billing_day` — cadastrar Fixo dia 15, consultar dia 14 (linha ausente) e dia 16 (linha presente) em `tests/integration/monthly-report-with-fixed-pay-lines.spec.ts`
- [X] T051 [P] [US3] Integration test: relatório por profissional Liberal soma só participações ativas e não-estornadas em `tests/integration/professional-report-liberal-participations.spec.ts`
- [X] T052 [P] [US3] Integration test: relatório por profissional Fixo mostra `monthly_amount_cents` + `billing_day` + `fixed_pay_lines[]` no período em `tests/integration/professional-report-fixed-shape.spec.ts`
- [X] T053 [P] [US3] Integration test SC-006: snapshot do relatório por profissional Comissionado pré- e pós-deploy deve ser idêntico em `tests/integration/professional-report-commissioned-regression.spec.ts`
- [X] T054 [P] [US3] Integration test fórmula resultado operacional: criar conjunto controlado (1 atendimento comissionado, 1 Fixo, 1 atendimento c/ assistente Liberal, 1 expense de tax, 1 expense operacional) e verificar cada linha + total em `tests/integration/operating-result-formula.spec.ts`

### Implementation for User Story 3

- [X] T055 [P] [US3] Implementar `selectMonthlyFixedPayLines(supabase, {tenantId, month})` (SELECT em view) em `src/lib/core/reports/monthly-fixed-pay-lines.ts`
- [X] T056 [US3] Estender agregador mensal em `src/lib/core/reports/monthly.ts` para incluir `fixed_pay_lines[]` + `totals.fixed_payments_cents`. Depende de T055
- [X] T057 [US3] Refatorar `reportByProfessional` em `src/lib/core/reports/by-professional.ts` para branchear por `payment_mode` retornando shape específico (3 variantes — comissionado intocado por regressão, fixo, liberal)
- [X] T058 [P] [US3] Implementar `computeOperatingResult(supabase, {tenantId, month})` somando os 6 termos da fórmula em `src/lib/core/reports/operating-result.ts`
- [X] T059 [US3] Atualizar handler `GET /api/relatorios/mensal` em `src/app/api/relatorios/mensal/route.ts` para incluir `fixed_pay_lines` + `totals.fixed_payments_cents`. Depende de T056
- [X] T060 [US3] Atualizar handler `GET /api/relatorios/por-profissional/[doctorId]` em `src/app/api/relatorios/por-profissional/[doctorId]/route.ts` para retornar shape conforme `payment_mode`. Depende de T057
- [X] T061 [US3] Criar handler `GET /api/relatorios/resultado-operacional` em `src/app/api/relatorios/resultado-operacional/route.ts` com `?month=YYYY-MM` (RBAC admin+financeiro). Depende de T058
- [X] T062 [P] [US3] Atualizar página em `src/app/(dashboard)/analise/relatorios/mensal/page.tsx` para renderizar seção "Pagamentos fixos" com linhas + total no card de resumo
- [X] T063 [P] [US3] Atualizar página em `src/app/(dashboard)/analise/relatorios/por-profissional/[doctorId]/page.tsx` para renderizar UI conforme `payment_mode` (3 templates — comissionado, fixo, liberal)
- [X] T064 [P] [US3] Criar página em `src/app/(dashboard)/analise/relatorios/resultado-operacional/page.tsx` exibindo a fórmula 6-linhas + drilldowns clicáveis para `/por-profissional`, `/mensal` e `/despesas`

**Checkpoint**: US3 entregável em produção. Relatórios cobrem as 3 modalidades + fórmula consolidada.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: validações finais e gates obrigatórios antes de merge.

- [X] T065 [P] Rodar `pnpm typecheck` na raiz — deve sair limpo
- [X] T066 [P] Rodar `pnpm lint:auth` — confirmar 100% dos handlers novos invocam `requireRole`
- [X] T067 [P] Rodar `pnpm test` (vitest full suite) — todos os contract + integration tests verdes
- [X] T068 Executar manualmente `specs/013-modalidades-pagamento-assistente/quickstart.md > Smoke test por User Story` (US1 → US2 → US3) e anotar resultados na descrição do PR
- [X] T069 [P] Capturar snapshot HTTP/JSON de `GET /api/relatorios/por-profissional/[comissionado_id]` antes e depois do deploy — confirmar 0 diffs (SC-006) e anexar ao PR
- [X] T070 [P] Verificar via SQL que cada doctor existente tem exatamente 1 row em `doctor_payment_terms_history` (backfill OK): `SELECT d.id, COUNT(h.id) FROM doctors d LEFT JOIN doctor_payment_terms_history h ON h.doctor_id = d.id GROUP BY d.id HAVING COUNT(h.id) <> 1` → espera 0 linhas
- [X] T071 [P] Verificar via SQL que `doctors.payment_mode` bate com head-of-chain em 100% dos doctors: `SELECT d.id FROM doctors d JOIN doctor_payment_terms_current pt ON pt.doctor_id = d.id WHERE d.payment_mode <> pt.payment_mode` → espera 0 linhas
- [X] T072 Atualizar `CLAUDE.md` na seção "Recent Changes" se necessário (script `update-agent-context.ps1` já rodou no /speckit.plan — apenas conferir)
- [X] T073 Cross-check final de invariantes em `data-model.md > §9` — confirmar que cada uma está protegida por trigger ou validação correspondente

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências — pode iniciar imediatamente
- **Foundational (Phase 2)**: depende do Setup. **Bloqueia US1–US3**
- **User Stories (Phases 3–5)**: todas dependem do Foundational
  - US1 (P1) é o MVP e desbloqueia o domínio (sem ela, US2 não tem liberais para selecionar e US3 não tem fixos para reportar)
  - US2 e US3 podem rodar **em paralelo** depois que US1 entrega a base de dados de modalidades
- **Polish (Phase 6)**: depende de todas as USs entregues

### User Story Dependencies

- **US1 (P1)**: depende apenas de Foundational
- **US2 (P2)**: depende de Foundational + de US1 ter populado pelo menos 1 doctor Liberal no banco. Tecnicamente o código de US2 não importa `payment-terms`, mas em runtime o filtro de "apenas liberais" só faz sentido se US1 estiver entregue. Em entrega incremental, manter ordem.
- **US3 (P3)**: depende de Foundational + de US1 (fixos cadastrados) + idealmente de US2 (liberais participando) para gerar números reais. Pode ser implementado em paralelo com US2 (arquivos distintos) — os dados de demo podem ser preparados manualmente.

### Within Each User Story

- Contract tests (T007–T012, T013, T029–T034, T050–T054) escritos primeiro — devem **FALHAR** antes do código de implementação ser commitado
- Models/services (T016–T021, T035–T041, T055–T058) antes de routes
- Routes (T022–T024, T042–T044, T059–T061) antes de UI
- UI (T025–T028, T045–T049, T062–T064) por último em cada story

### Parallel Opportunities

- **Phase 1**: T001 e T002 em paralelo
- **Phase 2**: depois de T003+T004 (sequenciais), T005–T012 todos em paralelo
- **Phase 3**: tests T013–T015 em paralelo; services T016–T018 em paralelo; UI T025–T027 em paralelo
- **Phase 4**: tests T029–T034 em paralelo; services T035–T038 em paralelo; UI T045 + T048 + T049 em paralelo
- **Phase 5**: tests T050–T054 em paralelo; services T055/T058 em paralelo; UI T062–T064 em paralelo
- **Phases 4 e 5 entre si**: depois que US1 entrega `doctors.payment_mode` populado, US2 e US3 são paralelizáveis por completo (arquivos totalmente distintos)
- **Phase 6**: T065–T067, T069–T071 em paralelo

---

## Parallel Example: User Story 1

```bash
# Lançar todos os tests de US1 em paralelo (antes da implementação):
Task: "Contract test RBAC POST /api/medicos com payment_mode (T013)"
Task: "Integration test criar 3 profissionais por modalidade (T014)"
Task: "Integration test mudança de modalidade com audit (T015)"

# Lançar todos os services de US1 em paralelo:
Task: "resolveCurrentPaymentTerms em src/lib/core/payment-terms/resolve-current.ts (T016)"
Task: "listPaymentTermsHistory em src/lib/core/payment-terms/list-history.ts (T017)"
Task: "updateDoctorPaymentMode em src/lib/core/doctors/update-payment-mode.ts (T018)"

# Lançar componentes UI de US1 em paralelo:
Task: "new-doctor-form com campos dinâmicos por modalidade (T025)"
Task: "Listagem com badge + valor adaptado (T026)"
Task: "payment-mode-editor client component (T027)"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Completar Phase 1: Setup (T001–T002)
2. Completar Phase 2: Foundational (T003–T012) — **CRITICAL**, bloqueia todas as USs
3. Completar Phase 3: User Story 1 (T013–T028)
4. **PARAR e VALIDAR**: rodar `quickstart.md > Smoke US1` independentemente. Cadastrar 3 profissionais, editar 1, ver histórico, conferir audit.
5. Deploy/demo se pronto.

### Incremental Delivery

1. Setup + Foundational + US1 → **deploy MVP**: clínica já consegue cadastrar profissionais nas 3 modalidades e ver na listagem, mesmo sem impacto operacional ou em relatórios.
2. + US2 → deploy: atendimentos com assistentes funciona end-to-end + visualização + calendário.
3. + US3 → deploy: relatórios financeiros refletem todas as modalidades + resultado operacional consolidado.

### Parallel Team Strategy

Com 2+ devs depois do Foundational:

1. Time conclui Setup + Foundational juntos (1 dev mexendo em SQL evita merge conflicts).
2. Quando Foundational está pronto:
   - Dev A: Phase 3 (US1 — core do domínio)
3. Quando US1 está pronto:
   - Dev A: Phase 4 (US2 — atendimento)
   - Dev B: Phase 5 (US3 — relatórios) — em paralelo
4. Polish (Phase 6) feito em conjunto antes do merge.

---

## Notes

- [P] tasks = arquivos distintos, sem dependência em tarefa incompleta
- [Story] mapeia tarefa para US específica para rastreabilidade no PR
- Cada US é independentemente completável e testável (com a ordem temporal recomendada para gerar dados reais)
- Contract tests T007–T012 e T013 **devem falhar** antes da migration 0084 + implementação dos handlers
- Commit após cada tarefa ou grupo lógico coerente (data-model, contracts, ou UI components costumam ser grupo natural)
- Parar em qualquer checkpoint para validar independentemente — feature é desenhada para entrega incremental
- Evitar: tasks vagas (sempre file path + ação específica); conflitos de arquivo entre `[P]` tasks; criar cross-story dependencies que quebrem a independência das stories
- **Constitution gates**: nenhum task introduz violação. Caso surja durante execução, adicionar entrada em `plan.md > Complexity Tracking` ANTES do merge

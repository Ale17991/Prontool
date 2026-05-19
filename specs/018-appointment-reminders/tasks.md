---
description: "Task list for 018 Appointment Reminders (Phase 1 — email)"
---

# Tasks: Motor de lembretes automáticos de consulta — email (Fase 1)

**Input**: Design documents from `/specs/018-appointment-reminders/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅, quickstart.md ✅

**Tests**: Testes de contrato e idempotência são **explicitamente obrigatórios** (Princípio II auditabilidade + Princípio III multi-tenant isolation + Regras do spec). Gate constitucional III (isolamento multi-tenant) **bloqueia merge** sem teste passando.

**Organization**: Tasks agrupadas por user story. A ordem das phases segue dependência implementacional explicada no plan: Foundational (migration + types) → US1 (admin UI — desbloqueia testar US2 com dados reais) → US2 (cron) → US4 (opt-in/opt-out — pequeno, valida filter em US2) → US3 (histórico + reenvio — precisa de dados de US2). Cada US encerra com commit obrigatório (regra do usuário: commit + push após cada feature).

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência incompleta)
- **[Story]**: a qual user story pertence (US1..US4). Setup/Foundational/Polish não levam label.
- Caminhos absolutos a partir de `C:\My project\` quando necessário; relativos a partir de `src/` ou `supabase/` para clareza.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: configurar Vercel Cron, env vars novas, capturar baselines.

- [x] T001 [P] `vercel.json` criado com cron `*/15 * * * *` apontando para `/api/cron/send-reminders`
- [x] T002 [P] `.env.example`: `CRON_SECRET` documentado entre Turnstile e Observability
- [x] T003 [P] Baseline typecheck PASS em `baselines/typecheck-before.txt`
- [x] T004 [P] **CORREÇÃO**: `date-fns-tz` NÃO está instalado (foi falso premise). Vou usar `Intl.DateTimeFormat` (pattern existente em 017). Documentado em `baselines/deps-check.md`
- [x] T005 [P] Paths livres confirmados em `baselines/path-conflict-check.md`

**Checkpoint**: ambiente preparado. Sem novas deps (já confirmado). Próximo: Foundational.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: migration 0094 + DTOs + tipo gerado. Sem isto, nenhuma user story pode ser implementada.

**⚠️ CRITICAL**: nenhum trabalho de US1/US2/US3/US4 pode começar até esta phase fechar.

- [x] T006 `supabase/migrations/0094_appointment_reminders.sql` criado: 8 colunas em tenant_clinic_profile + opt-in em patients + tabela appointment_reminders + 4 triggers (validate_offsets / audit / status_transition / no_delete) + RLS + 4 índices
- [x] T007 [P] Comments adicionados em tabela e colunas críticas
- [~] T008 **Bloqueado**: Docker Desktop não está rodando. Pendência manual para o reviewer rodar `pnpm supabase:reset` antes do merge
- [~] T009 **Bloqueado** pela mesma razão. Pendência manual após T008
- [x] T010 [P] `src/lib/core/reminders/types.ts`: 8 DTOs canônicos
- [x] T011 `pnpm typecheck` exit 0
- [x] T012 [P] Diretório `src/lib/core/reminders/` criado

**Checkpoint**: DB pronto. US1, US2, US4 podem começar em paralelo a partir daqui. US3 depende de US2.

---

## Phase 3: User Story 1 — Clínica configura motor de lembretes (Priority: P1)

**Goal**: admin/recepcionista habilita feature, configura antecedências, janela e template via `/configuracoes/lembretes`. Pré-requisito para testar US2 com dados reais.

**Independent Test**: como admin, abrir `/configuracoes/lembretes`, habilitar toggle, salvar com offset 24h e janela 08:00-20:00, recarregar — valores persistidos.

### Tests for User Story 1

- [x] T013 [P] [US1] `tests/unit/reminders-config-schema.spec.ts`: 16 tests PASS (offsets range, length, janela end>start, templates max length, enabled+offsets refine)
- [x] T014 [P] [US1] `tests/unit/reminders-rbac.spec.ts`: 6 tests PASS (admin/recepcionista pass, profissional_saude/financeiro/null/undefined block)

### Implementation for User Story 1

- [x] T015 [US1] `src/lib/core/reminders/config.ts`: `ReminderConfigUpdateSchema` + `getReminderConfig` + `updateReminderConfig`. Defaults consistentes com migration 0094 quando row não existe
- [x] T016 [US1] `actions.ts`: `saveReminderConfig` (Zod + RBAC + revalidate); `setPatientReminderOptIn` como placeholder pra US4
- [x] T017 [US1] `page.tsx` (server): getSession + redirect se sem permissão + renderiza ConfigForm com config inicial
- [x] T018 [US1] `config-form.tsx` (client): toggle enabled, chips de offsets com add/remove, 2 inputs time, toggle fim de semana, 2 inputs de template + 5 placeholders hint. useTransition + feedback inline (success-bg / destructive)
- [x] T019 [US1] Card "Lembretes automáticos" adicionado em `_cards.ts` com `BellRing` icon, visível p/ admin+recepcionista
- [x] T020 [US1] Action `reminders.config` registrada em `rbac.ts` (admin + recepcionista)
- [x] T021 [US1] Tests US1 PASS — 22 total
- [x] T022 [US1] `pnpm typecheck` exit 0
- [x] T023 [US1] Commit + push

**Checkpoint**: admin configura motor de lembretes. Próximo: US2 (envio automático).

---

## Phase 4: User Story 2 — Sistema envia lembrete automaticamente antes da consulta (Priority: P1)

**Goal**: cron a cada 15min seleciona agendamentos elegíveis, envia email via Resend, registra em `appointment_reminders` com idempotência via UNIQUE.

**Independent Test**: criar agendamento ~24h no futuro + paciente com email + opt-in. Disparar cron via `curl -H "Authorization: Bearer $CRON_SECRET" POST /api/cron/send-reminders`. Validar (a) email entregue (Resend dashboard), (b) row em `appointment_reminders` com `status=sent` + `provider_message_id` populado, (c) entrada em `audit_log` com `field='status'` `new_value='sent'`.

### Tests for User Story 2

- [ ] T024 [P] [US2] **Teste de contrato CRÍTICO de isolamento multi-tenant** — gate constitucional III. 2 tenants distintos, cada um com 1 appointment elegível. Cron processa ambos; cada registro tem `tenant_id` correto; tentativa de manipular query para "buscar" agendamentos de outro tenant não retorna nada. Em `tests/contract/reminders-tenant-isolation.spec.ts`. **GATE DE MERGE**.
- [ ] T025 [P] [US2] Teste de idempotência: rodar `processBatch` duas vezes consecutivas com mesmo input → apenas 1 row criada em `appointment_reminders` (UNIQUE partial WHERE is_manual=FALSE). Em `tests/contract/reminders-idempotency.spec.ts`
- [ ] T026 [P] [US2] Teste de unit `selectDueAppointments`: respeita janela (`now + offset ± 15min`), fim de semana toggle, janela horário, opt-in, não-estornado. Mock `now()` via `vi.setSystemTime`. Em `tests/unit/reminders-select-due.spec.ts`
- [ ] T027 [P] [US2] Teste de unit `renderEmail`: substitui placeholders, escapa HTML em cada valor (XSS proof), usa default quando template é null. Em `tests/unit/reminders-render-email.spec.ts`
- [ ] T028 [P] [US2] Teste de integração `cron-flow`: 1 tenant + 1 appointment elegível → POST `/api/cron/send-reminders` → response `processed=1, sent=1`. Resend mockado (vi.spyOn). Audit log verificado. Em `tests/integration/reminders-cron-flow.spec.ts`

### Implementation for User Story 2

- [ ] T029 [US2] Criar `src/lib/core/reminders/select-due.ts` com `selectDueAppointments(supabase, tenantId, offset, nowUtc, settings) → EligibleAppointment[]`. JOIN appointments com patients (opt-in, email) e antijoin com appointment_reversals + appointment_reminders existentes. Respeita janela do offset (`±15min`)
- [ ] T030 [US2] Criar `src/lib/core/reminders/render-email.ts` com `renderReminderEmail(template, placeholders) → { subject, html }`. Escape HTML em CADA valor substituído (defesa XSS). Fallback para template default quando `template.subject IS NULL OR template.body IS NULL`
- [ ] T031 [US2] Criar `src/lib/integrations/email/reminder-template.ts` com `getDefaultReminderTemplate() → { subject, body }`. HTML inline-style espelhando padrão de `booking-template.ts` (feature 017), com fuso "horário de Brasília" explícito. Inclui resolução de link de cancelamento conforme clarificação Q3 (hierarquia: token público se 017 + slug → landing pública → telefone textual)
- [ ] T032 [US2] Criar `src/lib/core/reminders/send-one.ts` com `sendOneReminder(supabase, eligibleAppointment, settings, channel) → ReminderRecord`. Pipeline:
  1. INSERT `appointment_reminders` com `status='queued'` + `ON CONFLICT DO NOTHING` (idempotência)
  2. Se conflito (já existe), early return sem enviar (outro ciclo já tratou)
  3. Revalidar elegibilidade: opt-in, não estornado, email não-nulo, médico ativo. Falha → UPDATE status=skipped_*
  4. Renderizar template (T030)
  5. Chamar `sendBookingEmail` ou nova fn `sendReminderEmail` no resend-client.ts (sem attachments)
  6. Sucesso → UPDATE status=sent + sent_at + provider_message_id; Falha → UPDATE status=failed + error
- [ ] T033 [US2] Estender `src/lib/integrations/email/resend-client.ts` com nova função `sendReminderEmail(input)` — input simplificado (sem attachments). Reusa configuração existente
- [ ] T034 [US2] Criar `src/lib/core/reminders/process-batch.ts` com `processBatch(supabase, allTenants, nowUtc) → ProcessBatchResult`. Loop por tenant (paralelo, limit 5) → loop por offset → coleta em buffer global; quando atinge 200 itens OU acabam tenants, `Promise.allSettled(buffer.map(sendOneReminder))`. Atualiza `reminder_last_run_at` por tenant processado. Retorna contadores agregados
- [ ] T035 [US2] Criar `src/app/api/cron/send-reminders/route.ts`. Validar `Authorization: Bearer ${CRON_SECRET}` (401 se inválido). Resolver tenants ativos (`reminder_enabled=TRUE`). Chamar `processBatch`. Retornar JSON conforme `contracts/cron-send-reminders.contract.md`
- [ ] T036 [US2] Configurar `src/lib/observability/logger.ts` (ou onde Pino é configurado): adicionar redact paths `['*.email', 'patient.email', 'to.email', 'patientEmail']` se ainda não cobertos. Documentar em comment a defesa LGPD em camadas
- [ ] T037 [US2] Rodar tests US2 (T024-T028) — TODOS devem passar. **T024 é gate de merge** (isolamento multi-tenant)
- [ ] T038 [US2] `pnpm typecheck` + `pnpm lint:auth` (garante CRON_SECRET-style auth em `/api/cron/*`)
- [ ] T039 [US2] Smoke manual conforme `quickstart.md` §5 (curl no endpoint do cron, validar via DB + Resend dashboard)
- [ ] T040 [US2] Commit + push: `feat(reminders): cron envia lembretes com idempotencia e audit (US2)`

**Checkpoint**: motor funcionando. Próximo: US4 (opt-in/opt-out — pequeno, valida o filter já implementado).

---

## Phase 5: User Story 4 — Paciente controla opt-in/opt-out (Priority: P3)

**Goal**: admin/recepcionista pode editar flag `reminders_opt_in` na ficha do paciente; motor respeita (já validado em US2).

**Independent Test**: editar paciente, desabilitar lembretes, criar agendamento novo, disparar cron → row em `appointment_reminders` com `status=skipped_opt_out`. Inbox vazio.

### Tests for User Story 4

- [ ] T041 [P] [US4] Teste de integração: paciente com `reminders_opt_in=FALSE` em agendamento elegível → `sendOneReminder` UPDATE status=skipped_opt_out sem chamar Resend (mock garante 0 chamadas). Em `tests/integration/reminders-opt-out.spec.ts`

### Implementation for User Story 4

- [ ] T042 [US4] Criar `src/lib/core/reminders/opt-in.ts` com `getPatientOptIn(supabase, patientId)` e `setPatientOptIn(supabase, patientId, optIn, tenantId)` (com filtro explícito de tenant_id — defense in depth)
- [ ] T043 [US4] Atualizar `src/app/(dashboard)/configuracoes/lembretes/actions.ts` — implementação completa de `setPatientReminderOptIn` (era placeholder em US1)
- [ ] T044 [US4] Criar `src/app/(dashboard)/operacao/pacientes/[id]/reminders-opt-in-toggle.tsx` (client) — toggle pequeno na seção de preferências do paciente; chama `setPatientReminderOptIn` action
- [ ] T045 [US4] Adicionar o toggle na página `src/app/(dashboard)/operacao/pacientes/[id]/page.tsx` — em uma seção "Preferências de comunicação" (criar seção se não existir)
- [ ] T046 [US4] Rodar tests US4 (T041) — deve passar
- [ ] T047 [US4] `pnpm typecheck` + `pnpm test:unit` (subset com testes da reminders/)
- [ ] T048 [US4] Commit + push: `feat(reminders): opt-in/opt-out por paciente (US4)`

**Checkpoint**: opt-out funcional. Próximo: US3 (histórico + reenvio).

---

## Phase 6: User Story 3 — Admin acompanha histórico e reenvia manualmente (Priority: P2)

**Goal**: tabela paginada de envios passados + lista de próximos 24h + botão "Reenviar manualmente" auditado.

**Independent Test**: depois de US2 ter rodado pelo menos 1 ciclo com sucesso, abrir `/configuracoes/lembretes`, ver registro no histórico, clicar "Reenviar" → novo email + novo registro com `is_manual=TRUE`.

### Tests for User Story 3

- [ ] T049 [P] [US3] Teste de integração: POST `/api/lembretes/<appointmentId>/reenviar` com paciente válido → 200 + novo row com `is_manual=TRUE` + Resend chamado uma vez. Em `tests/integration/reminders-manual-resend.spec.ts`
- [ ] T050 [P] [US3] Teste de contrato RBAC (parte 2): POST manual resend rejeita role `profissional_saude` com 403; admin/recepcionista passam. Em `tests/contract/reminders-rbac.spec.ts` (extender o spec criado em T014)
- [ ] T051 [P] [US3] Teste de integração: reenvio manual com paciente opt-out → 422 `PATIENT_OPT_OUT`. Idem com appointment estornado → 422 `REVERSED`. Mesmo spec do T049 ou anexo

### Implementation for User Story 3

- [ ] T052 [US3] Criar `src/lib/core/reminders/history.ts` com:
  - `listRemindersHistory(supabase, tenantId, { offset, limit }) → ReminderRecord[]`
  - `listUpcomingReminders(supabase, tenantId, hoursAhead=24) → EligibleAppointment[]` (preview — mesma lógica do selectDue mas com janela de hoursAhead)
- [ ] T053 [US3] Criar `src/app/(dashboard)/configuracoes/lembretes/history-table.tsx` (client): tabela paginada (20/page) com colunas: paciente, profissional, agendamento (data/hora), enviado em, status (badge colorido), ações. Botão "Reenviar" em cada linha
- [ ] T054 [US3] Adicionar seção "Próximos envios" na `page.tsx` da `/configuracoes/lembretes` mostrando até 20 lembretes agendados nas próximas 24h (server-side render)
- [ ] T055 [US3] Atualizar `page.tsx` para passar dados de histórico + próximos para a `<HistoryTable>` e remover placeholder
- [ ] T056 [US3] Criar `src/app/api/lembretes/[id]/reenviar/route.ts` POST handler conforme `contracts/api-reenviar-lembrete.contract.md`:
  1. `requireRole(['admin','recepcionista'])`
  2. Lookup appointment com filtro tenant_id
  3. Validar elegibilidade (opt-in, não estornado, email não-nulo)
  4. Chamar `sendOneReminder` com `is_manual=TRUE, scheduled_offset_hours=-1`
  5. Retornar JSON {reminderId, status, providerMessageId, errorMessage?}
- [ ] T057 [US3] Adicionar UX no `<HistoryTable>`: botão "Reenviar" dispara fetch POST + toast de feedback + revalidate da tabela. Bloqueia clicks duplos durante a request
- [ ] T058 [US3] Rodar tests US3 (T049-T051) — devem passar
- [ ] T059 [US3] `pnpm typecheck` + `pnpm lint:auth`
- [ ] T060 [US3] Smoke manual conforme `quickstart.md` §7 (validar histórico + reenvio)
- [ ] T061 [US3] Commit + push: `feat(reminders): historico + reenvio manual (US3)`

**Checkpoint**: feature 100% funcional. Próximo: polish.

---

## Phase 7: Polish & Cross-Cutting Validation

**Purpose**: smoke completo do quickstart, validação final pré-merge, atualização de docs.

- [ ] T062 [P] Validar manualmente todo o `quickstart.md` (§1-§12) — capturar screenshots/observações em `specs/018-appointment-reminders/baselines/quickstart-validation.md`
- [ ] T063 [P] Auditar logs em busca de email em texto claro — `Grep -r "patient.email" src/` em todas as rotas de `/api/cron/*` e `/api/lembretes/*`; conferir que somente `appointmentId` ou IDs internos aparecem em logs Pino. Documentar em `baselines/lgpd-email-audit.md`
- [ ] T064 [P] Verificar contraste WCAG AA na UI de `/configuracoes/lembretes` — usar DevTools axe ou WebAIM (design system 016 já cobre, mas confirmar customizações)
- [ ] T065 Atualizar checklist em `specs/018-appointment-reminders/checklists/requirements.md` marcando todos os 10 SCs validados (alguns ficam ⏳ pendentes de métricas pós-rollout — flagar)
- [ ] T066 Rodar `pnpm typecheck` + `pnpm test` finais (full suite) — capturar resultado; falhas pré-existentes (Docker-dependent integration) são aceitáveis se documentadas
- [ ] T067 Rodar `pnpm build` — confirmar zero erros + listar tamanhos das novas rotas
- [ ] T068 Atualizar `CLAUDE.md` se necessário rodando `pwsh .specify/scripts/powershell/update-agent-context.ps1 -AgentType claude` (idempotente; só roda se houver mudança técnica relevante)
- [ ] T069 Commit + push: `chore(reminders): polish + smoke quickstart + validacao final`
- [ ] T070 Criar PR ou abrir merge para master: `git checkout master && git merge 018-appointment-reminders --no-ff -m "Merge branch '018-appointment-reminders' — Motor de lembretes automaticos (Feature 018)"` + `git push origin master`

**Checkpoint**: feature 018 fechada. Pronto para review constitucional + rollout.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências externas — pode começar imediatamente em paralelo.
- **Foundational (Phase 2)**: depende de Setup; **BLOQUEIA US1, US2, US3, US4**.
- **US1 (Phase 3)**: depende de Foundational. **Recomendado primeiro** entre as US — desbloqueia teste de US2 com dados reais via UI.
- **US2 (Phase 4)**: depende de Foundational + US1 (precisa de tenant configurado para testar).
- **US4 (Phase 5)**: depende de Foundational; pode rodar em paralelo com US2 após Foundational. Pequena (4 tasks de impl), independente.
- **US3 (Phase 6)**: depende de US2 (precisa de dados no histórico) + Foundational.
- **Polish (Phase 7)**: depende de todas as US.

### Resumo visual

```text
Setup (T001..T005)
   │
   ├──> Foundational (T006..T012) — migration + types
   │       │
   │       ├──> US1 (T013..T023) — admin config UI
   │       │       │
   │       │       └──> US2 (T024..T040) — cron + envio (GATE T024)
   │       │               │
   │       │               ├──> US4 (T041..T048) — opt-in/opt-out
   │       │               │
   │       │               └──> US3 (T049..T061) — historico + reenvio
   │       │                       │
   │       │                       └──> Polish (T062..T070)
```

### Parallel execution examples

**Dentro do Setup**: T001, T002, T003, T004, T005 são todos `[P]` — abrir 5 terminais em paralelo.

**Dentro da Foundational**: T010 e T012 são `[P]` (arquivos diferentes), mas T008 (`supabase:reset`) e T009 (`gen-types`) são sequenciais (T009 depende de T008).

**Dentro de cada US**:
- Tests são `[P]` entre si (arquivos distintos).
- Implementations dentro da mesma US são geralmente sequenciais porque tocam mesmos arquivos (`actions.ts`, `page.tsx`, `process-batch.ts`).
- US4 pode rodar em paralelo com US3 após US2 fechar.

---

## Implementation Strategy

### MVP scope (entregável mínimo)

**Setup + Foundational + US1 + US2** (T001..T040) já é um MVP viável:
- Admin configura motor
- Cron envia lembretes automáticos
- Audit log capturando tudo
- Idempotência + isolamento multi-tenant garantidos

Sem US3 (histórico) e US4 (opt-out), a feature é utilizável mas:
- Admin não vê o que foi enviado (apenas Resend dashboard externo)
- Pacientes não conseguem opt-out (todos recebem)

Recomendação: ir até US4 (pequeno, 8 tasks) antes de pausar — o opt-out é exigência LGPD prática.

### Delivery incremental

- **Sprint 1 (4 dias)**: Setup + Foundational + US1 → admin já pode configurar a feature mesmo sem o motor pronto.
- **Sprint 2 (3 dias)**: US2 + US4 → motor funcional + LGPD compliance. **Marco de rollout interno.**
- **Sprint 3 (2 dias)**: US3 + Polish → feature completa. **Marco de rollout público.**

Total estimado: 9 dev-days (alinhado com estimativa do spec).

### Validation gates entre sprints

- **Após Sprint 1**: `pnpm typecheck` + `pnpm test:unit` + smoke manual T021/T022 do quickstart.
- **Após Sprint 2**: T024 (isolamento) DEVE passar antes de avançar. Smoke §5-§9 do quickstart. `pnpm lint:auth` verde.
- **Após Sprint 3**: `pnpm test` full + smoke completo do quickstart §1-§12 + merge para master.

---

## Format validation

✅ Todas as tasks seguem o formato `- [ ] [TaskID] [P?] [Story?] Description com file path`.
✅ Setup/Foundational/Polish não levam label de story; US1-US4 levam.
✅ Tasks com `[P]` tocam arquivos distintos sem dependência incompleta.
✅ Cada US tem independent test definido no header da phase.
✅ T024 (isolamento multi-tenant) marcado como gate constitucional III.

**Total: 70 tasks** divididas em 7 phases:
- Setup: 5 tasks
- Foundational: 7 tasks
- US1: 11 tasks (2 testes + 9 impl/commit)
- US2: 17 tasks (5 testes + 12 impl/commit) ← **GATE em T024**
- US4: 8 tasks (1 teste + 7 impl/commit)
- US3: 13 tasks (3 testes + 10 impl/commit)
- Polish: 9 tasks

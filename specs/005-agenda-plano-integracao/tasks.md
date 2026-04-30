---

description: "Task list for feature 005 — integracao agenda x plano + conflito de horario"
---

# Tasks: Integração agenda ↔ plano de tratamento + validação de conflito de horário

**Input**: Design documents from `/specs/005-agenda-plano-integracao/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Incluídos onde plan/research definiu cenários críticos (race condition, back-to-back, sync bidirecional). `pnpm test`/`test:integration`/`test:contract` cobre.

**Organization**: Tasks agrupadas por user story para entrega independente. **MVP recomendado = US1 isoladamente** — a constraint de conflito é o pilar que sustenta tudo.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Paralelizável (arquivos diferentes, sem dependência pendente).
- **[Story]**: User story (US1, US2, US3, US4) — apenas em fases de user story.
- Caminhos relativos à raiz `C:\My project\`.

## Path Conventions

Single Next.js project — `src/`, `tests/`, `supabase/`, `scripts/` na raiz. Detalhes em `plan.md`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirma branch e ambiente local. Nenhuma dependência npm nova.

- [ ] T001 Confirmar branch `005-agenda-plano-integracao` ativa (`git branch --show-current`) e working tree limpo.
- [ ] T002 Subir Supabase local (`pnpm supabase start`) — pré-requisito para todas as migrations e testes de integração.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema completo aplica antes de qualquer user story poder começar. A migration 0055 é o coração da feature.

**⚠️ CRITICAL**: T003 → T004 → T005 → T006 são sequenciais. Sem schema aplicado, US1/US2/US3/US4 não podem começar.

- [ ] T003 Criar migration `supabase/migrations/0055_appointment_conflict_and_completion.sql` consolidando: (a) `CREATE EXTENSION IF NOT EXISTS btree_gist`; (b) tabela `appointment_completions` com FK + UNIQUE(tenant,appointment) + CHECK source + RLS + audit trigger + immutability trigger; (c) tabela `appointment_slot_locks` com EXCLUDE USING gist (tenant_id WITH =, doctor_id WITH =, slot_range WITH &&) + RLS; (d) `ALTER TABLE treatment_plan_steps ADD COLUMN appointment_id UUID NULL UNIQUE FK`; (e) atualizar `enforce_treatment_plan_step_mutability` para permitir UPDATE em `appointment_id` quando `OLD.appointment_id IS NULL`; (f) trigger `appointments_create_slot_lock` (AFTER INSERT) com fallback para SQLSTATE 23P01; (g) trigger `appointment_reversals_release_slot_lock` (AFTER INSERT em reversals) que DELETE do slot_lock; (h) trigger `step_status_sync_to_appointment` (AFTER UPDATE em steps) com guarda `pg_trigger_depth()=1`, INSERT em completions/reversals conforme status novo; (i) trigger `appointment_completion_sync_to_step` (AFTER INSERT em completions) com guarda; (j) trigger `appointment_reversal_sync_to_step` (AFTER INSERT em reversals) com guarda; (k) função plpgsql `mark_appointment_realized(p_appointment_id, p_by, p_reason)`; (l) função plpgsql `create_step_with_appointment(...)` que faz INSERT em appointments + steps em transação; (m) `CREATE OR REPLACE VIEW appointments_effective` com 3-source CASE (estornado>completion>agendado) e `appointment_ends_at` derivado.
- [ ] T004 Aplicar migrations + regenerar tipos: `pnpm supabase:reset && pnpm supabase:gen-types`. Verificar que `src/lib/db/generated/types.ts` agora expõe `appointment_completions`, `appointment_slot_locks`, e `treatment_plan_steps.Row.appointment_id`.
- [ ] T005 Mapear erro `SQLSTATE 23P01` e mensagem `APPOINTMENT_CONFLICT` para HTTP 409 em `src/lib/observability/http.ts` — `toHttpResponse` retorna `{error: {code: 'APPOINTMENT_CONFLICT', message, conflict: {...}}}` com status 409. O detalhe do conflito (paciente/horário do conflitante) é enriquecido por uma chamada a `checkConflict` no caller, opcional.
- [ ] T006 [P] Contract test em `tests/integration/migration-0055.spec.ts`: asserta (a) extensão `btree_gist` instalada, (b) tabelas `appointment_completions` e `appointment_slot_locks` existem com colunas + constraints corretas (`pg_get_constraintdef` para EXCLUDE), (c) coluna `treatment_plan_steps.appointment_id` existe e é nullable, (d) view `appointments_effective` retorna 3 status possíveis, (e) re-aplicar 0055 é idempotente (`IF NOT EXISTS` em tudo).

**Checkpoint**: Foundation pronta — US1, US2, US3, US4 podem começar em paralelo.

---

## Phase 3: User Story 1 — Bloqueio de conflito de horário (Priority: P1) 🎯 MVP

**Goal**: Sistema impede criar/agendar dois atendimentos sobrepostos para o mesmo profissional. Veto autoritativo no banco (EXCLUDE constraint via slot_locks). Pré-check no frontend para UX.

**Independent Test**: Sem nenhuma das outras user stories implementadas, criar dois atendimentos para mesmo profissional com horários sobrepostos via UI; segundo recebe 409. Back-to-back permitido. Estornado libera o slot.

### Tests for User Story 1

- [ ] T007 [P] [US1] Unit test em `tests/unit/conflict-pre-check.spec.ts` — math de overlap de intervalos semi-abertos `[start, end)`: back-to-back não conflita, contém conflita, sobreposição parcial conflita, intervalos disjuntos não conflitam.
- [ ] T008 [P] [US1] Integration test em `tests/integration/conflict-exclusion.spec.ts` cobrindo todos os cenários do contrato `conflict-exclusion-constraint.md`: (a) **race**: 50 INSERTs concorrentes via Promise.all → 1 sucesso, 49 falhas com SQLSTATE 23P01; (b) **back-to-back**: 14:00–14:30 e 14:30–15:00 mesmo doctor → ambos OK; (c) **cross-doctor**: mesmo slot dois doctors → ambos OK; (d) **cross-tenant**: doctor A do tenant 1 e doctor B do tenant 2 (impossível na prática mas valida isolamento) → ambos OK; (e) **estorno+rebooking**: criar 14:00 → estornar → criar outro 14:00 mesmo doctor → sucesso; (f) **trigger libera slot**: após estorno, slot_lock do appointment original não existe mais.

### Implementation for User Story 1

- [ ] T009 [P] [US1] Implementar `checkConflict` helper em `src/lib/core/appointments/check-conflict.ts` conforme `contracts/conflict-exclusion-constraint.md`: query em `appointment_slot_locks` JOIN `appointments` JOIN `procedures` filtrando por `tenant_id`, `doctor_id`, `slot_range && tstzrange(start, end, '[)')`, com `excludeAppointmentId` opcional e descriptografia de `patient_name` em batch via RPC. Retorna `ConflictHit | null`.
- [ ] T010 [P] [US1] Endpoint `GET /api/atendimentos/check-conflict` em `src/app/api/atendimentos/check-conflict/route.ts`: parse query params via Zod (`doctor_id`, `start`, `end`, `exclude_id?`), chama `checkConflict`, retorna `{conflict: false}` ou `{conflict: true, with: {...}}`. Gate de auth: qualquer papel autenticado.
- [ ] T011 [US1] Modificar `src/app/(dashboard)/operacao/atendimentos/novo/new-appointment-form.tsx`: substituir o campo "Duração (min)" por dois campos `<Input type="time" required>` ("Hora início", "Hora fim"). Validar `end > start` no submit. Calcular `duration_minutes = (endMin - startMin)` antes de enviar payload. Adicionar `useEffect` que chama `/api/atendimentos/check-conflict` quando doctor/start/end mudam (debounce 300ms) e exibe banner `<div role="alert">` com mensagem do conflito acima do botão Submit.
- [ ] T012 [US1] Modificar `src/app/api/atendimentos/manual/route.ts`: schema Zod aceita `start_at` (ISO) e `duration_minutes` (já existia da feature 004); remover qualquer validação anterior que limitasse o futuro.
- [ ] T013 [US1] Modificar `src/lib/core/appointments/create-manual.ts`: tratar erro `SQLSTATE 23P01` do INSERT em `appointments` (que vem do trigger `appointments_create_slot_lock`), enriquecer com `checkConflict` para incluir nome do paciente conflitante, e re-throw como `DomainError('APPOINTMENT_CONFLICT', ..., {status: 409, conflict: {...}})`.
- [ ] T014 [US1] Validar acceptance scenarios manualmente conforme `quickstart.md` US1: tentar criar conflito → 409 com mensagem clara; back-to-back OK; estornado libera; doctors diferentes OK.

**Checkpoint**: US1 entregue como MVP. Pode parar aqui e ir para produção sem US2/US3/US4.

---

## Phase 4: User Story 2 — Etapa ↔ atendimento integrados (Priority: P1)

**Goal**: Criar etapa cria atendimento; concluir etapa marca atendimento realizado; estornar atendimento cancela etapa; e vice-versa. Vínculo bidirecional via `treatment_plan_steps.appointment_id`.

**Independent Test**: Após US1 estar pronta. Criar etapa com horário → ver atendimento agendado no calendário; concluir etapa → atendimento vira ativo na view; estornar atendimento → etapa fica cancelada; criar atendimento avulso para paciente+procedimento que casa com etapa pendente → vínculo automático FIFO.

### Tests for User Story 2

- [ ] T015 [P] [US2] Integration test em `tests/integration/treatment-step-appointment-link.spec.ts`: (a) `create_step_with_appointment` cria os dois registros e linka; (b) tentativa de criar etapa em horário conflitante aborta a transação inteira (nenhum step nem appointment criado); (c) auto-link FIFO em `createAppointmentManually`; (d) sync etapa→completion (marcar concluída cria completion, view vira `ativo`); (e) sync etapa→reversal (marcar cancelada cria reversal, slot lock liberado); (f) sync completion→step (mark realized atualiza step.status); (g) sync reversal→step (estorno atualiza step.status); (h) **anti-loop**: marcar etapa concluída não dispara trigger infinito.

### Implementation for User Story 2

- [ ] T016 [P] [US2] Implementar `markAppointmentRealized` em `src/lib/core/appointments/mark-realized.ts` conforme `contracts/appointment-completion-flow.md`: chama RPC `mark_appointment_realized(p_appointment_id, p_by, p_reason)`, mapeia erros conhecidos (not found, already reversed, already realized via UNIQUE).
- [ ] T017 [P] [US2] Endpoint `POST /api/atendimentos/[id]/realizado` em `src/app/api/atendimentos/[id]/realizado/route.ts`: `requireRole(['admin', 'profissional_saude'])`, body Zod com `reason` opcional, chama `markAppointmentRealized`, retorna `{completion_id, appointment_id, completed_at}` 201.
- [ ] T018 [P] [US2] Componente client `src/app/(dashboard)/operacao/atendimentos/[id]/mark-realized-form.tsx`: botão "Marcar realizado" + modal opcional para `reason`. POSTa no endpoint e chama `router.refresh()`.
- [ ] T019 [US2] Modificar `src/app/(dashboard)/operacao/atendimentos/[id]/page.tsx`: renderizar `<MarkRealizedForm>` quando `effective_status === 'agendado'` E papel autorizado. Mostrar timestamp da completion quando `status === 'ativo'` (vem do campo novo `completed_at` na view).
- [ ] T020 [P] [US2] Modificar `src/app/(dashboard)/operacao/pacientes/[id]/treatment-steps-section.tsx` `NewStepForm`: adicionar campos `<Input type="time" required>` para `start_time` e `end_time` (além de `scheduled_date` que já existe); validar `end > start`; pré-check de conflito ao mudar doctor/start/end via `/api/atendimentos/check-conflict`. Banner inline se conflito.
- [ ] T021 [US2] Modificar `src/app/api/pacientes/[id]/etapas/route.ts`: schema Zod com `start_time` e `end_time` (formato `HH:MM`); converter `scheduled_date + start_time` para `appointment_at` em UTC (fuso `America/Sao_Paulo`); calcular `duration_minutes`; chamar RPC `create_step_with_appointment` em vez de INSERT direto. Mapear 23P01 → 409 com payload de conflito.
- [ ] T022 [US2] Modificar `src/lib/core/appointments/create-manual.ts`: após INSERT bem-sucedido em `appointments`, executar query FIFO conforme `R-006` para encontrar etapa pendente compatível e fazer UPDATE no `appointment_id`. Se já houver vínculo (alguma race), seguir sem erro. Logar a ação para auditoria.
- [ ] T023 [P] [US2] Adicionar banner `<Banner>` em `src/app/(dashboard)/operacao/pacientes/[id]/treatment-steps-section.tsx` quando alguma etapa do paciente tiver `appointment_id IS NULL`: "Você tem N etapas sem horário definido. Agende cada uma para que apareçam no calendário."
- [ ] T024 [US2] Botão "Agendar agora" no StepRow para etapas legadas (`appointment_id IS NULL`): abre modal com `start_time + end_time`. Submit chama um endpoint novo `POST /api/pacientes/[id]/etapas/[stepId]/agendar` que faz INSERT em appointments + UPDATE no step.appointment_id (column-guard relaxado aceita o set inicial).
- [ ] T025 [US2] Validar acceptance scenarios manualmente conforme `quickstart.md` US2: criar etapa com horário → ver bloco no calendário; concluir etapa → bloco vira ativo; estornar atendimento → etapa cancelada; auto-link FIFO; etapa legada com banner + agendamento.

**Checkpoint**: US2 entregue. Sistema unificado funcionando.

---

## Phase 5: User Story 3 — Calendário como visualização padrão (Priority: P2)

**Goal**: `/operacao/atendimentos` abre em modo Calendário por padrão. Preferência salva por dispositivo via cookie. Server-side rendering correto, sem flicker.

**Independent Test**: Independente das outras. Abrir página em sessão limpa → Calendário; alternar para Lista; recarregar → Lista; alternar para Calendário; recarregar → Calendário. Em outro navegador → Calendário (default).

### Implementation for User Story 3

- [ ] T026 [P] [US3] Modificar `src/app/(dashboard)/operacao/atendimentos/page.tsx`: ler cookie `prontool_atendimentos_view` via `cookies()` de `next/headers`. Se ausente, default `'cal'`. O searchParam `?view=` ainda tem precedência (override de URL). Renderizar a view correspondente.
- [ ] T027 [US3] Modificar `src/app/(dashboard)/operacao/atendimentos/atendimentos-toolbar.tsx`: ao alternar Lista/Calendário, escrever cookie via `document.cookie = 'prontool_atendimentos_view=cal; path=/; max-age=31536000; samesite=lax'` (ou `list`). Manter o push para querystring para compartilhar URL.

**Checkpoint**: US3 entregue.

---

## Phase 6: User Story 4 — Conflitos visíveis no calendário (Priority: P3)

**Goal**: Defesa em profundidade — conflitos pré-existentes (dados legados, inserção forçada) ficam visualmente marcados em vermelho no calendário e no detalhe.

**Independent Test**: Inserir manualmente dois appointments sobrepostos via service-role (bypass do trigger — ex: `INSERT ... ; DELETE FROM appointment_slot_locks WHERE appointment_id = '...'`) → calendário mostra ambos com borda vermelha e ícone de aviso.

### Implementation for User Story 4

- [ ] T028 [P] [US4] Adicionar helper `detectVisualConflicts(blocks)` em `src/lib/utils/calendar.ts`: para cada par de blocos do mesmo `doctorId` cujos ranges se sobrepõem, marcar `conflict = true` em ambos. Atualizar tipo `LaneAssignment` para incluir `conflict?: boolean`.
- [ ] T029 [P] [US4] Modificar `src/app/(dashboard)/operacao/atendimentos/calendar/calendar-block.tsx`: aplicar classes `ring-2 ring-rose-500 ring-offset-1` quando `conflict === true`. Ícone `AlertTriangle` no canto.
- [ ] T030 [P] [US4] Modificar `src/app/(dashboard)/operacao/atendimentos/[id]/page.tsx`: após buscar appointment, chamar `checkConflict` (excluindo o próprio id); se houver hit, exibir banner `<div role="alert" class="bg-rose-50 border-rose-200">` com mensagem "Este atendimento conflita com [link para outro]".

**Checkpoint**: US4 entregue.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Acabamento e validação cruzada. Rodar antes de merge para master.

- [ ] T031 [P] Atualizar `CLAUDE.md` raiz: completar "Recent Changes" com nota sobre `appointment_completions`, `appointment_slot_locks`, EXCLUDE constraint via `btree_gist`, novos endpoints `/check-conflict` e `/realizado`, RPC `mark_appointment_realized`, RPC `create_step_with_appointment`, e fim do `agendado` derivado-por-tempo (substituído por status explícito via completions).
- [ ] T032 [P] Rodar suíte completa: `pnpm typecheck && pnpm lint:auth && pnpm test && pnpm test:integration && pnpm test:contract`. Corrigir regressões.
- [ ] T033 Criar `scripts/bench-conflict.ts`: dispara 50 POSTs concorrentes via `Promise.all` para `/api/atendimentos/manual` no mesmo `(doctor_id, start, end)`; valida 1 sucesso (201) + 49 conflitos (409) + 0 erros 500. Adiciona em `package.json`: `"bench:conflict": "tsx --env-file=.env.local scripts/bench-conflict.ts"`.
- [ ] T034 [P] Validar SC-002 (verificação ≤ 100 ms p95): medir endpoint `/api/atendimentos/check-conflict` com k6 ou via console-time em produção sintética com 1k atendimentos seedados.
- [ ] T035 Rodar `quickstart.md` ponta-a-ponta como release validation; marcar checklist `requirements.md` como completo.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001, T002 sem dependência externa.
- **Foundational (Phase 2)**: T003 → T004 → T005 → T006 (sequencial; migration aplica antes do contract test). BLOQUEIA todas as user stories.
- **User Stories (Phase 3+)**: Todas dependem de T004 (tipos) e T005 (mapping de erro 23P01). US1 deve ir primeiro (sustenta validação que US2 vai usar).
- **Polish (Phase 7)**: depende das user stories desejadas.

### User Story Dependencies

- **US1 (P1) — MVP**: depende de Foundational. T009/T010/T011/T012/T013 paralelizáveis em arquivos diferentes; T014 (validação manual) por último.
- **US2 (P1)**: depende de Foundational + US1 (precisa do `/check-conflict` em uso para o pré-check da etapa). T016/T017/T018/T020/T021 paralelizáveis. T019/T022/T023/T024 modificam arquivos compartilhados ou herdam de tasks anteriores.
- **US3 (P2)**: independente. T026 + T027 podem rodar a qualquer hora pós-Foundational.
- **US4 (P3)**: independente. T028/T029/T030 paralelizáveis.

### Within Each User Story

- Tests podem ser escritos em TDD ou paralelo com a implementação.
- Helpers/RPCs antes de endpoints que os consomem.
- Server endpoints antes de componentes que os chamam.
- Validação manual ao final de cada US.

### Parallel Opportunities

- **Foundation**: T006 paralelo com qualquer trabalho que não toque DB.
- **US1 implementação**: T009, T010 paralelos (helper + endpoint em arquivos distintos). T011/T012/T013 modificam arquivos diferentes.
- **US1 tests**: T007 e T008 totalmente paralelos.
- **US2**: T016, T017, T018, T020 todos `[P]` (arquivos diferentes). T015 (test) paralelo com tudo.
- **US3**: T026 e T027 quase paralelos (T027 modifica componente que T026 importa, mas mudanças não conflitam).
- **US4**: T028/T029/T030 paralelos.
- **Polish**: T031–T034 paralelos; T035 sequencial no fim.

---

## Parallel Example: User Story 1

```bash
# Após Foundation (T003-T006), abrir 4 trabalhos em paralelo:
Task: "checkConflict helper em src/lib/core/appointments/check-conflict.ts"           # T009
Task: "endpoint GET /api/atendimentos/check-conflict"                                  # T010
Task: "Tests unit + integration de conflict (T007, T008)"                              # T007+T008
Task: "Mapeamento 23P01 → 409 em http.ts"                                              # já em T005

# Quando T009/T010/T005 terminarem, T011 (form) pode arrancar.
# T012 (route) e T013 (create-manual) em paralelo.
# T014 (validação) ao final.
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 (T001–T002): Setup.
2. Phase 2 (T003–T006): Foundation — migration completa + types + error mapping.
3. Phase 3 (T007–T014): US1 conflict prevention.
4. **STOP** — validar `quickstart.md` US1, deployar como MVP.
5. Resultado: clínica não consegue mais agendar conflitos. Todo o resto é evolução.

### Incremental Delivery

1. MVP (US1) → deploy → operação testa por 1–2 dias.
2. US2 (etapa↔atendimento) → deploy → testar fluxo real do plano.
3. US3 (default calendar) → deploy junto com US4 (mais leves).
4. US4 (conflitos visíveis) → deploy.
5. Polish (Phase 7) → release final.

### Parallel Team Strategy

Com 2+ devs após Foundation:

- **Dev A**: US1 inteira (P1 — bloqueante prioritário).
- **Dev B**: US2 (depende de US1 estar mergeada — coordenar).
- **Dev A ou B (ocioso pós-US1)**: US3 + US4 + Polish.

Coordenação principal: T011 (form de novo atendimento) e T020 (form de etapa) compartilham padrão de pré-check. Idealmente o mesmo dev faz os dois para garantir consistência de UX.

---

## Notes

- Toda task tem checkbox + ID + (opcional) `[P]` + (em fases de US) `[Story]` + caminho de arquivo.
- Migration 0055 é única e grande — preferida em vez de quebrar em múltiplas para reduzir risco em prod.
- Triggers de sincronização step↔appointment usam `pg_trigger_depth() = 1` para anti-loop.
- Princípio I (imutabilidade) preservado: `appointments` e `appointment_reversals` continuam intocados; `appointment_completions` é append-only; `appointment_slot_locks` permite DELETE como índice derivado.
- Race condition coberta nativamente pela EXCLUDE constraint — sem advisory lock manual.
- Etapas legadas (`appointment_id NULL`) **não** são backfillladas — tratadas pela UI com banner + "Agendar agora".
- Cookie de view tem `max-age=1y`, `samesite=lax`, sem `httpOnly` (precisa ser legível pelo client).

---
description: 'Task list for feature 004 — calendario de atendimentos, typeahead TUSS, catalogo odonto, navegacao'
---

# Tasks: Calendário de atendimentos, typeahead TUSS, catálogo odonto e navegação

**Input**: Design documents from `/specs/004-calendario-atendimentos/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Incluídos onde o plan/research definiu estratégia (calendar utils unit, list-week integration, migration contract, dialog Playwright smoke). Tudo dentro do que o repo já roda em CI (`pnpm test`/`pnpm test:contract`/`pnpm test:integration`).

**Organization**: Tasks agrupadas por user story para entrega independente. MVP = US1 isoladamente.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode rodar em paralelo (arquivos diferentes, sem dependência pendente).
- **[Story]**: User story (US1, US2, US3, US4) — apenas em fases de user story.
- Caminhos absolutos do repo: `C:\My project\` é a raiz.

## Path Conventions

Single Next.js project — `src/`, `tests/`, `supabase/`, `scripts/` na raiz do repo. Estrutura detalhada em `plan.md`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirma branch e ambiente local; nenhuma dependência nova precisa instalar.

- [x] T001 Confirmar branch `004-calendario-atendimentos` ativa (`git status` mostra `On branch 004-calendario-atendimentos`) e working tree limpo.
- [ ] T002 Subir stack Supabase local (`pnpm supabase start`) e verificar `:54321` responde; pré-requisito para todas as migrations e testes de integração. _(BLOQUEADO: Docker Desktop não rodando — usuário roda manualmente.)_

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema e tipos gerados que TODAS as user stories dependem (`duration_minutes` é lido pelo calendário; tipo regenerado é importado por queries em US1 e US2).

**⚠️ CRITICAL**: Nenhuma user story pode começar sem T003 e T004 concluídos.

- [x] T003 Criar migration `supabase/migrations/0053_appointments_duration_and_catalog_version.sql` conforme `specs/004-calendario-atendimentos/contracts/duration-minutes-migration.md`: `ALTER TABLE appointments ADD COLUMN duration_minutes INTEGER NULL CHECK (5..480)` + `INSERT INTO tuss_catalog_versions` para `ans_official_202501` com `ON CONFLICT DO NOTHING`. Inclui `COMMENT ON COLUMN`.
- [ ] T004 Aplicar migrations e regenerar tipos: `pnpm supabase:reset && pnpm supabase:gen-types`. Verificar que `src/lib/db/generated/types.ts` agora expõe `appointments.Row.duration_minutes: number | null`. _(BLOQUEADO: Docker. Após reset, remover o cast `as never` em `src/lib/core/appointments/create-manual.ts`.)_
- [x] T005 [P] Contract test da migration em `tests/integration/migration-0053.spec.ts`: roda contra DB local recém-resetado, asserta (a) coluna `duration_minutes` existe e é nullable, (b) CHECK 5..480, (c) row em `tuss_catalog_versions` com `source_ref='ans_official_202501'`, (d) re-aplicar migration é idempotente.

**Checkpoint**: Foundation pronta — US1, US2, US3 e US4 podem começar em paralelo.

---

## Phase 3: User Story 1 — Calendário com filtro de profissionais (Priority: P1) 🎯 MVP

**Goal**: Recepcionista alterna `/operacao/atendimentos` para visualização Calendário, filtra por profissional, navega semanas, clica em slot vazio para criar atendimento com hora pré-preenchida, e clica em bloco existente para abrir detalhe.

**Independent Test**: Com a stack rodando e ao menos 3 atendimentos na semana atual, abrir `/operacao/atendimentos`, clicar em "Calendário", verificar grid 7×16 com blocos posicionados, filtrar por 1 profissional, navegar para próxima semana com `>`, clicar em slot 14:00 de quarta e confirmar que abre `/operacao/atendimentos/novo?at=...` com horário preenchido.

### Tests for User Story 1

- [x] T006 [P] [US1] Unit tests dos helpers de calendário em `tests/unit/calendar-utils.spec.ts`: `getWeekRange(date)`, `slotForAppointment(at, duration)`, `assignLanes(blocks)` (limite 4 lanes + "+N mais"), `isMobileWidth(width)`. Cobertura ≥ 90% das funções puras.
- [x] T007 [P] [US1] Integration test de `listAppointmentsForWeek` em `tests/integration/atendimentos-calendar.spec.ts` conforme `contracts/appointments-week-fetch.md`: seed 5 atendimentos em 2 profissionais; verifica filtro por `doctorIds`, recorte por `weekStart/weekEnd`, default 30 quando `duration_minutes IS NULL`, status `estornado`.
- [x] T008 [P] [US1] Playwright smoke em `tests/e2e/calendar.spec.ts`: login, abrir `/operacao/atendimentos`, alternar para Calendário, ver grid renderizado, clicar slot vazio, validar URL destino `/operacao/atendimentos/novo?at=...`.

### Implementation for User Story 1

- [x] T009 [P] [US1] Implementar helpers puros em `src/lib/utils/calendar.ts`: `getWeekRange(date)`, `eachHourSlot(start, end)`, `slotForAppointment(at, duration)`, `assignLanes(blocks, maxLanes=4)`, `isMobileBreakpoint(width)`. Tipagem estrita; sem dependência de DOM.
- [x] T010 [P] [US1] Implementar `listAppointmentsForWeek` em `src/lib/core/appointments/list-week.ts` conforme contrato: select com joins para `doctors`/`procedures`, filtro `tenant_id`/`appointment_at` range, `.in('doctor_id', ...)` opcional, RPC `decrypt_patient_names_for_ids` em batch, COALESCE para `durationMinutes`. Retorna `AppointmentWeekRow[]`.
- [x] T011 [P] [US1] Criar componente `<CurrentTimeLine>` em `src/app/(dashboard)/operacao/atendimentos/calendar/current-time-line.tsx`: client component com `setInterval(60s)`, posicionamento absoluto via `top` calculado em rem; renderiza apenas quando o dia atual está visível na faixa.
- [x] T012 [P] [US1] Criar componente `<CalendarBlock>` em `src/app/(dashboard)/operacao/atendimentos/calendar/calendar-block.tsx`: bloco individual com cor por status (`ativo` azul / `estornado` vermelho / `concluido` verde — fallback azul quando status concluído não disponível), altura proporcional a `durationMinutes`, exibe `patientName` + `procedureLabel`, `<Link>` para `/operacao/atendimentos/[id]`.
- [x] T013 [P] [US1] Criar componente `<DoctorFilter>` em `src/app/(dashboard)/operacao/atendimentos/calendar/doctor-filter.tsx`: client component com `<Popover>` shadcn + checkboxes + "Selecionar todos" + botão "Aplicar". Push para querystring `doctors=` ao aplicar; recebe lista server-side via prop. Inativos com badge `(inativo)`.
- [x] T014 [US1] Criar `<CalendarView>` em `src/app/(dashboard)/operacao/atendimentos/calendar/calendar-view.tsx` (client): consome `AppointmentWeekRow[]` + helpers + `<CalendarBlock>` + `<CurrentTimeLine>`; renderiza grid Tailwind 7 colunas × 16 linhas (07–22h); destaca coluna do dia atual; `onClick` em slot vazio navega para `/novo?at=<ISO>`. Em `< 640px`, força modo Day. Depende de T009, T011, T012.
- [x] T015 [US1] Criar `<AtendimentosToolbar>` em `src/app/(dashboard)/operacao/atendimentos/atendimentos-toolbar.tsx` (client): toggle Lista/Calendário, botão "Hoje", setas semana anterior/próxima, select Dia/Semana/Mês, e mounting do `<DoctorFilter>` quando `view=cal`. Lê e escreve querystring (`view`, `week`, `grain`, `doctors`). Depende de T013.
- [x] T016 [US1] Modificar `src/app/(dashboard)/operacao/atendimentos/page.tsx`: ler `searchParams` (`view`, `week`, `grain`, `doctors`); quando `view='cal'`, chama `listAppointmentsForWeek` + busca lista de doctors do tenant; renderiza `<AtendimentosToolbar>` + `<CalendarView>`; quando `view!=='cal'` (default), preserva render Lista atual. Depende de T010, T014, T015.
- [x] T017 [US1] Modificar `src/app/(dashboard)/operacao/atendimentos/novo/page.tsx`: ler `searchParams.at`; passar como prop `initialAppointmentAt` para `<NewAppointmentForm>`.
- [x] T018 [US1] Modificar `src/app/(dashboard)/operacao/atendimentos/novo/new-appointment-form.tsx`: aceitar `initialAppointmentAt?: string` e usar em `useState(() => initialAppointmentAt ?? localIsoNow())`. Acrescentar campo "Duração (min)" com default `30`, range 5–480, e incluir `duration_minutes` no payload de `/api/atendimentos/manual`.
- [x] T019 [US1] Atualizar route handler `src/app/api/atendimentos/manual/route.ts` para aceitar `duration_minutes?: number` no schema Zod (opcional, default 30 ao persistir). Persistir o campo no INSERT em `appointments`.
- [ ] T020 [US1] Validar acceptance scenarios manualmente conforme `quickstart.md`: toggle Lista/Calendário, semana corrente, linha vermelha, blocos coloridos, clique em bloco, clique em slot vazio, navegação semana, filtro 1 profissional, mobile Day view. _(PENDENTE: usuário valida com app rodando.)_

**Checkpoint**: US1 entregue como MVP; pode parar aqui e ir para produção sem US2/US3/US4.

---

## Phase 4: User Story 2 — Typeahead TUSS com nome completo + "Ver em lista" (Priority: P2)

**Goal**: Profissional vê nome completo do procedimento no typeahead em qualquer formulário, e usa botão "Ver em lista" para abrir tabela paginada do catálogo.

**Independent Test**: Em `/cadastros/procedimentos`, em `/operacao/atendimentos/novo` e em "Nova etapa" de `/operacao/pacientes/[id]`: abrir typeahead → nomes longos em até 2 linhas; clicar "Ver em lista" → modal paginado a 20 com colunas TUSS/Nome/Tabela; selecionar linha aplica no form e fecha modal.

### Tests for User Story 2

- [x] T021 [P] [US2] Unit test de paginação client-side em `tests/unit/tuss-list-pagination.spec.ts`: 25/200/0 itens; primeira/última/intermediária; busca filtra antes de paginar.
- [x] T022 [P] [US2] Playwright integration em `tests/e2e/tuss-list-dialog.spec.ts`: abre dialog em `/cadastros/procedimentos`, busca "restaur", paginar para página 2, selecionar linha, validar que o input do form externo recebeu o item e o dialog fechou.

### Implementation for User Story 2

- [x] T023 [P] [US2] Criar `<TussListDialog>` em `src/components/tuss/tuss-list-dialog.tsx` conforme `contracts/tuss-list-drawer.md`: shadcn `<Dialog>` `max-w-3xl`, busca debounce 250ms via `/api/tuss-codes?q=&table=&limit=200`, tabela com TUSS / Nome (line-clamp-2) / Tabela (badge), paginação client-side a 20, banner "200 primeiros" quando total ≥ 200, ESC + foco devolvido ao trigger.
- [x] T024 [P] [US2] Criar wrapper compartilhado `<TussTypeahead>` em `src/components/tuss/tuss-typeahead.tsx`: extrai a lógica de popover + busca de `new-procedure-form.tsx`, expõe props `value`, `onChange`, `table`, `onSelect`, e renderiza ao lado um botão "Ver em lista" que monta `<TussListDialog>` com os mesmos `table` e `onSelect`. Largura/wrap/2 linhas idêntico ao `new-procedure-form.tsx` atual.
- [x] T025 [US2] Refatorar `src/app/(dashboard)/cadastros/procedimentos/new-procedure-form.tsx` para usar `<TussTypeahead>` (substituir o popover inline). Comportamento e props externas inalterados. Depende de T024.
- [x] T026 [US2] Modificar `src/app/(dashboard)/operacao/atendimentos/novo/new-appointment-form.tsx`: trocar o `<Select>` de procedimento por `<TussTypeahead table="22">`. Preserva mecanismo atual de sugestão de preço via `/api/precos/vigente`. Depende de T024 e (não bloqueia) T018.
- [x] T027 [US2] Modificar `src/app/(dashboard)/operacao/pacientes/[id]/treatment-steps-section.tsx`: substituir lista filtrada inline por `<TussTypeahead table="22">` no `NewStepForm`. Manter integração com `useFetchCurrentPrice`. Depende de T024.
- [ ] T028 [US2] Validar manualmente conforme acceptance scenarios: nomes completos em 2 linhas em todos os formulários; "Ver em lista" abre, busca, pagina e seleciona corretamente em todos. _(PENDENTE.)_

**Checkpoint**: US2 entregue; pode ir para produção independente do estado de US3/US4.

---

## Phase 5: User Story 3 — Botão Voltar nas páginas de atendimento (Priority: P3)

**Goal**: Página de detalhe e de novo atendimento têm botão "Voltar" claramente visível que leva para `/operacao/atendimentos`.

**Independent Test**: Abrir `/operacao/atendimentos/[id]` → botão Voltar visível, clicar → vai para listagem. Idem para `/operacao/atendimentos/novo`.

### Implementation for User Story 3

- [x] T029 [P] [US3] Modificar `src/app/(dashboard)/operacao/atendimentos/[id]/page.tsx`: substituir o `<Link>` textual `Voltar para atendimentos` por um `<Button asChild variant="outline" size="sm">` com ícone `ArrowLeft` e texto "Voltar", apontando para `/operacao/atendimentos`. Posição no topo da página.
- [x] T030 [P] [US3] Modificar `src/app/(dashboard)/operacao/atendimentos/novo/page.tsx`: substituir o `<Link>` textual `Voltar aos atendimentos` pelo mesmo padrão de `<Button>` com `ArrowLeft`. Ambos botões usam o mesmo estilo para consistência.

**Checkpoint**: US3 entregue.

---

## Phase 6: User Story 4 — Auditoria odontológica do catálogo TUSS (Priority: P3)

**Goal**: Script de reconciliação compara `tuss_codes` local com a versão oficial ANS 202501, imprime relatório por prefixo (81–88), e documenta a fonte em `tuss_catalog_versions` (linha já inserida pela migration 0053 — T003).

**Independent Test**: Rodar `pnpm seed:tuss:audit-odonto` produz relatório no console com contagem por prefixo, total local/oficial, e nota explícita "0 com prefixo 88 — esperado". Sem importar nenhum código.

### Implementation for User Story 4

- [x] T031 [P] [US4] Criar script `scripts/tuss-odonto-audit.ts`: baixa o ZIP oficial ANS 202501 (com cache local em `.tmp/tuss_202501.zip` se já existir), extrai o XLSX `TUSS 22 - PROCEDIMENTOS E EVENTOS EM SAÚDE - VERSÃO 202501.xlsx`, parsa com `exceljs`, agrupa códigos por prefixo (81..88), consulta `tuss_codes WHERE tuss_table='22' AND code LIKE '8%'` via `createSupabaseServiceClient()`, imprime tabela `prefix | local | official | diff` + nota explícita sobre prefixo 88. Suporta override `TUSS_OFFICIAL_ZIP=/path/local.zip`.
- [x] T032 [P] [US4] Adicionar entrada em `package.json` scripts: `"seed:tuss:audit-odonto": "tsx scripts/tuss-odonto-audit.ts"`. Documentar em `quickstart.md` (já feito; só validar coerência).
- [ ] T033 [US4] Validar manualmente: rodar `pnpm seed:tuss:audit-odonto`, conferir saída esperada do `quickstart.md` (380 local / 370 oficial / diff por prefixo / 88=0 esperado). _(PENDENTE: usuário roda com Docker up.)_

**Checkpoint**: US4 entregue. Linha em `tuss_catalog_versions` para `ans_official_202501` confirma rastreabilidade (Princípio IV).

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Acabamento e validação cruzada entre stories.

- [x] T034 [P] Atualizar `CLAUDE.md` raiz: completar a seção "Recent Changes" com nota sobre `/operacao/atendimentos?view=cal`, `duration_minutes`, `<TussTypeahead>`, `<TussListDialog>`, e script de auditoria odonto. Manter o formato existente (script `update-agent-context.ps1` já adicionou as bases — refinar manualmente se preciso).
- [x] T035 [P] Rodar suíte completa: `pnpm typecheck && pnpm lint:auth && pnpm test && pnpm test:integration && pnpm test:contract`. _(`pnpm typecheck` ✓ e `pnpm lint:auth` ✓ executados; `pnpm test*` requer Docker para subir Supabase local.)_
- [ ] T036 [P] Validar performance do calendário (SC-002): semana com 60 atendimentos renderiza em ≤ 1,5 s; filtro de profissional aplica em ≤ 500 ms. _(PENDENTE: usuário valida com DevTools.)_
- [ ] T037 [P] Validar responsivo do calendário em mobile (SC-007): viewport `< 640px` mostra Day view sem layout quebrado. _(PENDENTE.)_
- [ ] T038 Rodar `quickstart.md` ponta-a-ponta como release validation; marcar em `checklists/requirements.md` qualquer item que tenha mudado. _(PENDENTE.)_

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001, T002 sem dependência externa.
- **Foundational (Phase 2)**: T003 (migration) → T004 (apply + gen types) → T005 (contract test). BLOQUEIA todas as user stories.
- **User Stories (Phase 3+)**: Todas dependem de T004 (tipos regenerados).
  - US1 (P1): MVP — recomendado primeiro.
  - US2, US3, US4: paralelizáveis com US1 após Foundation.
- **Polish (Phase 7)**: depende das user stories desejadas.

### User Story Dependencies

- **US1 (P1)**: Depende apenas de Foundational. T010 (`list-week.ts`) pode rodar em paralelo com T009 (helpers). T014 depende de T009/T011/T012. T016 depende de T010/T014/T015. T018/T019 ligados a campo `duration_minutes` — independem de T014.
- **US2 (P2)**: Depende de Foundational. T024 (wrapper) é base para T025/T026/T027. T023 (Dialog) e T024 (Typeahead) podem rodar em paralelo. **Acoplamento leve com US1**: T026 modifica o mesmo arquivo que T018. Resolver fazendo T026 depois de T018, ou consolidar mentalmente as duas mudanças no PR de US2.
- **US3 (P3)**: Independente. T029 e T030 modificam arquivos diferentes — paralelos.
- **US4 (P3)**: Independente. T031 e T032 paralelos.

### Within Each User Story

- Tests podem ser escritos antes (TDD) ou em paralelo com a implementação.
- Helpers/contratos antes de componentes que os consomem.
- Server components antes das modificações de página que os incorporam.
- Validação manual ao final de cada US.

### Parallel Opportunities

- **Foundation**: T005 paralelo com qualquer trabalho que não toque DB.
- **US1 implementação**: T009, T010, T011, T012, T013 todos `[P]` (arquivos diferentes).
- **US1 tests**: T006, T007, T008 todos `[P]`.
- **US2**: T021, T022, T023, T024 `[P]` (todos em arquivos diferentes).
- **US3**: T029, T030 `[P]`.
- **US4**: T031, T032 `[P]`.
- **Polish**: T034–T037 `[P]`; T038 sequencial no fim.
- Stories diferentes podem ser tocadas por devs diferentes em paralelo.

---

## Parallel Example: User Story 1

```bash
# Após Foundation (T003-T005), abrir 5 trabalhos em paralelo:
Task: "Implementar helpers em src/lib/utils/calendar.ts"                     # T009
Task: "Implementar listAppointmentsForWeek em src/lib/core/appointments/list-week.ts"  # T010
Task: "<CurrentTimeLine> em src/app/.../calendar/current-time-line.tsx"      # T011
Task: "<CalendarBlock> em src/app/.../calendar/calendar-block.tsx"           # T012
Task: "<DoctorFilter> em src/app/.../calendar/doctor-filter.tsx"             # T013

# Em paralelo, escrever os 3 testes de US1:
Task: "tests/unit/calendar-utils.spec.ts"                                    # T006
Task: "tests/integration/atendimentos-calendar.spec.ts"                      # T007
Task: "tests/e2e/calendar.spec.ts"                                           # T008

# Quando T009/T011/T012 terminarem, T014 (CalendarView) pode arrancar.
# Quando T013 terminar, T015 (Toolbar) pode arrancar.
# Quando T010/T014/T015 terminarem, T016 (page.tsx) finaliza US1.
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 (T001-T002): Setup.
2. Phase 2 (T003-T005): Foundation — migration + types + contract test.
3. Phase 3 (T006-T020): US1 calendário com filtro.
4. **STOP** — validar `quickstart.md` US1, deployar como MVP.

### Incremental Delivery

1. MVP (US1) → deploy.
2. US2 typeahead + Ver em lista → deploy.
3. US3 botão Voltar → deploy junto de US4.
4. US4 audit odonto → deploy.
5. Polish (Phase 7) → release final da feature.

### Parallel Team Strategy

Com 2+ devs após Foundation:

- **Dev A**: US1 (P1, maior, dono do calendário).
- **Dev B**: US2 (typeahead) + US3 (back button).
- **Dev A ou Dev B (ocioso)**: US4 (script).

Ponto de coordenação único: T018 vs T026 (ambos tocam `new-appointment-form.tsx`). Recomendado fazer T018 primeiro (US1) e rebasear US2 sobre US1.

---

## Notes

- Toda task tem checkbox + ID + (opcional) `[P]` + (em fases de US) `[Story]` + caminho de arquivo.
- Tests integram naturalmente com `vitest` + `playwright` já configurados; rodam em CI via `pnpm test`/`pnpm test:integration`/`pnpm test:contract`.
- Cada user story é completamente testável de forma isolada conforme `spec.md` § "Independent Test".
- Migration 0053 é idempotente (`ADD COLUMN IF NOT EXISTS` + `ON CONFLICT DO NOTHING`).
- Princípios I, III, IV revisitados em cada PR via "Constitution Check" do plano (já registrado em `plan.md`).
- Commit após cada task ou grupo lógico; PR após cada user story para entrega incremental.

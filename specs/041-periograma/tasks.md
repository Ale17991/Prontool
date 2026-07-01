# Tasks: Periograma (periodontograma) odontológico — Fase 3

**Input**: Design documents from `/specs/041-periograma/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/periograma-api.md

**Tests**: Incluídos — o projeto usa `pnpm test:contract` / `pnpm test:integration` em todas as features do módulo (padrão 039/040).

**Organization**: Tarefas agrupadas por user story (P1 → P2 → P3), cada uma entregável e testável de forma independente.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos distintos, sem dependência pendente)
- **[Story]**: US1/US2/US3 (mapeia para as user stories do spec)

## Path Conventions

Web app Next.js single-app: migrations em `supabase/migrations/`, core em `src/lib/core/dental/perio/`, rotas em `src/app/api/pacientes/[id]/periograma/`, UI em `src/app/(dashboard)/operacao/pacientes/[id]/_components/perio/`, testes em `tests/`.

---

## Phase 1: Setup

**Purpose**: Preparar estrutura de diretórios da feature.

- [x] T001 Criar os diretórios `src/lib/core/dental/perio/`, `src/app/api/pacientes/[id]/periograma/`, `src/app/(dashboard)/operacao/pacientes/[id]/_components/perio/` (placeholders vazios ou `.gitkeep`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, triggers, RPC e o módulo de cálculo puro — base de todas as stories.

**⚠️ CRITICAL**: Nenhuma user story começa antes desta fase.

- [x] T002 Criar a migration `supabase/migrations/0161_perio_chart.sql` com as 3 tabelas (`perio_exams`, `perio_site_measurements`, `perio_tooth_findings`), índices (incl. UNIQUE parcial de rascunho único e UNIQUE naturais) e RLS por `tenant_id` conforme `data-model.md` (idempotente)
- [x] T003 Adicionar à `0161_perio_chart.sql` os triggers: `enforce_perio_exam_update` (transição rascunho→finalizado + núcleo imutável), `enforce_perio_exam_delete` (DELETE só em rascunho), `check_perio_child` (consistência de tenant), `enforce_perio_child_writable` (congela escrita quando exame não está em rascunho) e auditoria `log_audit_event` (created/finalized)
- [x] T004 Adicionar à `0161_perio_chart.sql` a RPC `perio_exam_indicators(p_tenant_id, p_exam_id)` (STABLE SECURITY DEFINER, guarda de tenant) retornando BOP%, bolsas ≥4mm, CAL médio
- [x] T005 Migration aplicada localmente via `pnpm supabase:reset` (`0161` aplicou limpa) + `pnpm seed:demo`. Tipos: o regen oficial (`gen-types`) revelou drift pré-existente em `tenant_clinic_profile` (`surgical_scan_required`) não relacionado ao periograma; mantido o `types.ts` curado do repo + adições manuais das 3 tabelas perio + RPC (typecheck verde). **Pendente só**: aplicar `0161` em PRODUÇÃO via SQL Editor.
- [x] T006 [P] Criar o módulo puro `src/lib/core/dental/perio/sites.ts`: constantes dos 6 sítios (`db,b,mb,dl,l,ml`), faixas plausíveis (PD 0–15, recessão −5..+15), `calcCal(pd, rec)`, e `calcIndicators(measurements, findings)` (BOP%, bolsas ≥4mm, CAL médio; ignora dentes ausentes e sítios não medidos)
- [x] T007 [P] Unit test do cálculo em `tests/unit/perio-calc.test.ts` (CAL com recessão positiva/negativa; indicadores com dentes ausentes e sítios vazios)

**Checkpoint**: Schema + cálculo prontos — user stories podem começar.

---

## Phase 3: User Story 1 - Registrar um exame periodontal completo (Priority: P1) 🎯 MVP

**Goal**: Criar exame em rascunho, preencher a grade (6 sítios/dente + achados por dente), salvar e finalizar (congelando).

**Independent Test**: Criar exame, preencher medições, salvar, reabrir (persistiu), finalizar (vira somente-leitura); 2º rascunho é rejeitado; valor fora de faixa rejeitado.

### Tests for User Story 1

- [x] T008 [P] [US1] Contract test em `tests/contract/perio-exam-immutability.test.ts`: único rascunho (409 DRAFT_EXISTS), congelamento pós-finalização (PATCH/DELETE bloqueados), validação de faixa (PD 20 → erro), transição inválida (finalizar 2×)
- [x] T009 [P] [US1] Integration test em `tests/integration/perio-tenant-isolation.test.ts`: exame/medições não vazam entre tenants
- [x] T010 [P] [US1] Integration test em `tests/integration/perio-rbac.test.ts`: papel não-clínico não cria/edita/finaliza; papéis de leitura conseguem ver

### Implementation for User Story 1

- [x] T011 [P] [US1] `src/lib/core/dental/perio/create-exam.ts` — cria exame em rascunho; mapeia violação do UNIQUE de rascunho para erro `DRAFT_EXISTS`
- [x] T012 [P] [US1] `src/lib/core/dental/perio/save-measurements.ts` — upsert em lote de medições (`ON CONFLICT (exam_id, tooth_fdi, site)`) e achados (`ON CONFLICT (exam_id, tooth_fdi)`); valida faixas via `sites.ts`
- [x] T013 [P] [US1] `src/lib/core/dental/perio/finalize-exam.ts` — transição rascunho→finalizado (carimba finalized_at/by); mapeia 42501 para erro de transição
- [x] T014 [P] [US1] `src/lib/core/dental/perio/discard-exam.ts` — DELETE de rascunho; bloqueia se finalizado
- [x] T015 [P] [US1] `src/lib/core/dental/perio/get-exam.ts` — exame completo (header + medições + achados + indicadores via RPC)
- [x] T016 [P] [US1] `src/lib/core/dental/perio/list-exams.ts` — exames do paciente ordenados por data + indicadores resumidos + `draftId`
- [x] T017 [US1] Rota `src/app/api/pacientes/[id]/periograma/route.ts` — GET (lista) / POST (cria rascunho); `requireRole`, Zod, `toHttpResponse`
- [x] T018 [US1] Rota `src/app/api/pacientes/[id]/periograma/[examId]/route.ts` — GET (completo) / PATCH (salvar lote, só rascunho) / DELETE (descartar rascunho)
- [x] T019 [US1] Rota `src/app/api/pacientes/[id]/periograma/[examId]/finalizar/route.ts` — POST (finaliza)
- [x] T020 [US1] `src/app/(dashboard)/operacao/pacientes/[id]/_components/perio/perio-chart-grid.tsx` — grade (dentes em colunas via `teeth.ts`, linhas PD/recessão/BOP por arcada, inputs com navegação por teclado, CAL por sítio ao vivo, marcação ausente/implante/mobilidade/furca)
- [x] T021 [US1] `src/app/(dashboard)/operacao/pacientes/[id]/_components/perio/perio-tab.tsx` — orquestra: lista exames, criar/abrir/finalizar/descartar, alterna dentição; salva em lote (debounced) via PATCH
- [x] T022 [US1] Integrar seção "Periograma" em `src/app/(dashboard)/operacao/pacientes/[id]/_components/odontogram/odonto-space.tsx` (nova entrada em `SECTIONS`, passando `canWriteClinical`)

**Checkpoint**: US1 funcional — registro completo de exame com congelamento. MVP entregável.

---

## Phase 4: User Story 2 - Comparar exames ao longo do tempo (Priority: P2)

**Goal**: Selecionar dois exames finalizados e ver variação de PD/sangramento por sítio + deltas de indicadores.

**Independent Test**: Com dois exames finalizados, abrir comparação e conferir deltas por sítio e agregados; com um só exame, mensagem de "precisa de dois".

### Tests for User Story 2

- [x] T023 [P] [US2] Integration test em `tests/integration/perio-compare.test.ts`: comparação retorna deltas corretos por sítio e agregados; < 2 exames → 400 NEED_TWO_EXAMS

### Implementation for User Story 2

- [x] T024 [P] [US2] `src/lib/core/dental/perio/compare-exams.ts` — junta dois exames por (tooth_fdi, site), calcula deltaPd e mudança de sangramento + deltas de indicadores
- [x] T025 [US2] Rota `src/app/api/pacientes/[id]/periograma/comparar/route.ts` — GET `?from=&to=` (ambos finalizados, do mesmo paciente)
- [x] T026 [US2] `src/app/(dashboard)/operacao/pacientes/[id]/_components/perio/perio-compare.tsx` — seletor de duas datas + grade de variação por sítio + cartões de delta (opcionalmente gráfico `recharts`)
- [x] T027 [US2] Adicionar alternância "Exame / Comparar" no `perio-tab.tsx`

**Checkpoint**: US1 + US2 funcionais de forma independente.

---

## Phase 5: User Story 3 - Resumo periodontal e indicadores (Priority: P3)

**Goal**: Painel de indicadores (BOP%, bolsas ≥4mm, CAL médio) que recalcula ao vivo durante a digitação no rascunho.

**Independent Test**: Inserir conjunto conhecido de medições e ver os três indicadores baterem com o cálculo manual; atualização ao vivo no rascunho.

### Implementation for User Story 3

- [x] T028 [P] [US3] `src/app/(dashboard)/operacao/pacientes/[id]/_components/perio/perio-indicators.tsx` — painel dos 3 indicadores a partir de `sites.ts` (cliente)
- [x] T029 [US3] Ligar o painel no `perio-tab.tsx`/`perio-chart-grid.tsx`: recálculo ao vivo via `sites.ts` durante a edição e exibição dos indicadores da RPC ao carregar exame finalizado

**Checkpoint**: Todas as user stories independentes e funcionais.

---

## Phase 6: Polish & Cross-Cutting

- [x] T030 [P] `pnpm typecheck` + `pnpm lint:auth` verdes
- [x] T031 Testes automatizados executados — **22/22 verdes** (`perio-calc` unit, `perio-exam-immutability` contract, `perio-tenant-isolation`/`perio-rbac`/`perio-compare` integration). Validação manual no browser (quickstart) opcional — ainda não feita.
- [x] T032 [P] Atualizar a memória do projeto (`project_odontograma.md`) com o estado da Fase 3

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (T001)**: sem dependências.
- **Foundational (T002–T007)**: depende do Setup; **bloqueia todas as stories**. T003/T004 dependem de T002 (mesmo arquivo, sequenciais). T005 depende de T002–T004. T006/T007 independem do banco (paralelos).
- **US1 (T008–T022)**: depende da Foundational. Núcleo (T011–T016) depende de T005 (tipos) + T006 (cálculo). Rotas (T017–T019) dependem do núcleo. UI (T020–T022) depende das rotas.
- **US2 (T023–T027)**: depende da Foundational; usa exames criados na US1, mas é testável isolada com seeds.
- **US3 (T028–T029)**: depende da Foundational (sites.ts) + grade da US1.
- **Polish (T030–T032)**: depois das stories desejadas.

### Within Each User Story

- Tests primeiro (devem falhar antes da implementação) → núcleo → rotas → UI.

### Parallel Opportunities

- T006 e T007 em paralelo na Foundational.
- US1: T008/T009/T010 (testes) em paralelo; T011–T016 (núcleo, arquivos distintos) em paralelo.
- Após a Foundational, US1/US2/US3 podem ser tocadas por devs diferentes (US2/US3 dependem de pontos da US1 para integração final).

---

## Implementation Strategy

### MVP First (US1)

1. Setup (T001) → Foundational (T002–T007) → US1 (T008–T022).
2. **PARAR e VALIDAR**: registrar e finalizar um exame completo.
3. Demo do MVP.

### Incremental Delivery

1. Foundational pronto.
2. US1 → testar → demo (MVP).
3. US2 (comparação) → testar → demo.
4. US3 (indicadores ao vivo) → testar → demo.

---

## Notes

- Tests do projeto apagam o banco local (`resetDatabase()`); rodar só fora de teste manual e re-seedar com `pnpm seed:demo`.
- Fora desta versão (follow-up): estadiamento/grau AAP 2017, exportação PDF, configuração de 4-sítios.
- Commit por tarefa ou grupo lógico; cada checkpoint é validável isoladamente.

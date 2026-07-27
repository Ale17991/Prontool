# Tasks: Micronutrientes, DRIs, Análise de Adequação e Recordatório (R24h)

**Input**: Design documents from `/specs/049-micronutrientes-dri-recordatorio/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, quickstart.md

**Tests**: incluídos — a constituição exige testes de isolamento multi-tenant (III) e RBAC (V) para features que tocam dados por tenant; o motor de soma/adequação exige teste de "números batendo" (SC-002/SC-003).

**Organization**: por história de usuário (US1 micros → US2 DRIs+adequação → US3 recordatório). US1 é pré-requisito das demais.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: paralelizável (arquivos diferentes, sem dependência pendente)
- **[Story]**: US1 / US2 / US3

---

## Phase 1: Setup (extração de dados das planilhas)

**Purpose**: preparar os gabaritos vindos de `nutri-doc/` antes de codar.

- [X] T001 Extrair a aba `BD ALIMENTOS` de `nutri-doc/AF..xlsm` (6570 alimentos, por 100 g) para CSV/JSON com nome+energia+macros+os ~37 micros, via streaming (`ExcelJS.stream.xlsx.WorkbookReader`), salvando em `scratchpad/` ou `scripts/data/`
- [ ] T002 Extrair a aba `BD_DRIs` de `nutri-doc/Evonut.xlsm` para CSV/JSON de recomendações por nutriente × sexo × faixa etária × estado
- [ ] T003 [P] Levantar as colunas de micros da `BD ALIMENTOS` e mapear cada uma para uma `nutrient_key` canônica (ex.: `calcio_mg`, `ferro_mg`, `vitamina_c_mg`) + unidade + `driKey`, registrando em `specs/049-micronutrientes-dri-recordatorio/research.md` (apêndice de mapeamento)

---

## Phase 2: Foundational (bloqueia todas as histórias)

**Purpose**: plumbing compartilhado — coluna de micros, catálogo TS e motor de soma estendido.

**⚠️ CRÍTICO**: nenhuma história começa antes disto.

- [X] T004 Migration (próximo nº após 0180) `ALTER TABLE public.foods ADD COLUMN IF NOT EXISTS micronutrients JSONB NULL` + refresh do `catalog_baseline.foods` (gotcha 0170), em `supabase/migrations/0181_food_micronutrients.sql`
- [X] T005 Catálogo canônico dos ~37 micros em `src/lib/core/nutrition/micronutrients.ts` (`{ key, label, unit, driKey }[]` + helpers de acesso)
- [X] T006 Estender o motor de soma em `src/lib/core/nutrition/diet/totals.ts`: `Nutrients` e `FoodRef` ganham `micros: Record<string, number>`; `itemNutrients`/somas escalam micros por regra de três (mantendo isomorfia cliente/servidor); ausência = chave omitida
- [X] T007 [P] Unit test do motor com micros (números batendo, ausência não vira zero) em `tests/unit/nutrition-micros-totals.spec.ts`

**Checkpoint**: base pronta — histórias podem começar.

---

## Phase 3: User Story 1 - Micronutrientes na base (Priority: P1) 🎯 MVP

**Goal**: alimentos carregam micros; busca/cadastro os expõem; totais do plano somam micros.

**Independent Test**: buscar um alimento e ver seus micros; montar um plano e ver os micros somados no total do dia; cadastrar alimento próprio com micros.

### Tests (US1)

- [X] T008 [P] [US1] Integration test: alimento global com micros → `search_foods`/DTO retornam `micronutrients`; plano soma micros no total do dia, em `tests/integration/foods-micros.spec.ts`
- [ ] T009 [P] [US1] Integration test: cadastro de alimento próprio com micros persiste e conta no plano, em `tests/integration/custom-food-micros.spec.ts`

### Implementation (US1)

- [X] T010 [US1] Script de importação `scripts/build-foods-micros.ts`: lê o CSV/JSON de T001 e faz upsert dos alimentos globais em `public.foods` (source `af_bdalimentos`, `tenant_id NULL`) preenchendo `energy/macros/fibra + micronutrients`; idempotente por `(source, external_code)`/nome
- [X] T011 [US1] Adicionar target `pnpm seed:foods-micros` (roda o import) em `package.json` + garantir sobrevivência ao reset via `catalog_baseline`
- [X] T012 [P] [US1] Estender `src/lib/core/nutrition/foods/search.ts` (DTO `FoodDTO` + RPC/select) para incluir `micronutrients`
- [X] T013 [P] [US1] Estender `src/lib/core/nutrition/foods/custom.ts` + `src/app/api/alimentos/route.ts` (schema Zod) para aceitar/gravar `micronutrients` (opcionais, validação de plausibilidade)
- [X] T014 [US1] UI Config→Alimentos (`src/app/(dashboard)/configuracoes/alimentos/foods-catalog-client.tsx`): exibir os micros disponíveis do alimento e campo (opcional) de micros no cadastro próprio
- [X] T015 [US1] Plano Alimentar (`src/app/(dashboard)/operacao/plano-alimentar/plan-builder-client.tsx` + `diet/plan.ts`): totais do dia passam a exibir os principais micros; leitura/gravação carregam micros
- [X] T015b [US1] Limpeza das listas de substituição em prod (Ambiente de testes): com os alimentos individuais da base AF disponíveis, **expandir opções agrupadas** (ex.: "Carnes Magras: Patinho, Acém, Frango, Tilápia…") em **opções OU individuais**, cada uma com a grama calibrada pela meta de kcal da lista; desativar o alimento agrupado. Varrer todas as listas por nomes com múltiplos alimentos (`:` / lista separada por vírgula que não seja nome TACO). Script tsx idempotente.

**Checkpoint**: US1 funcional e testável isolada.

---

## Phase 4: User Story 2 - DRIs + Análise de adequação (Priority: P2)

**Goal**: comparar o total do plano/recordatório com a recomendação (DRI) do paciente, com % e classificação.

**Depende de**: US1 (micros nos totais).

**Independent Test**: paciente com idade/sexo + plano montado → análise mostra % de adequação por nutriente (abaixo/adequado/acima), carências e excessos.

### Tests (US2)

- [ ] T016 [P] [US2] Unit test do motor de adequação (`<90% abaixo`, `90–110% adequado`, `>110% acima`, `sem_referencia`) em `tests/unit/nutrition-adequacy.spec.ts`
- [ ] T017 [P] [US2] Integration test `GET /api/pacientes/[id]/adequacao?source=plano` (idade da data de nascimento; override manual) em `tests/integration/adequacao-plano.spec.ts`

### Implementation (US2)

- [ ] T018 [US2] Migration `supabase/migrations/0182_dietary_reference_intakes.sql`: tabela global `dietary_reference_intakes` (RLS read-only, UNIQUE `(nutrient_key,sex,age_min,age_max,state)`, índice de lookup) + refresh do `catalog_baseline`
- [ ] T019 [US2] Script/seed `scripts/build-dris-seed.ts` + `pnpm seed:dris` populando a tabela a partir do CSV/JSON de T002
- [ ] T020 [P] [US2] `src/lib/core/nutrition/dri/read.ts`: lookup por `(nutrient_key, sex, ageYears, state)` com fallback `any`/`padrao`
- [ ] T021 [US2] `src/lib/core/nutrition/adequacy.ts`: motor puro (totais + paciente + DRIs → `AdequacyItem[]` + resumo de carências/excessos)
- [ ] T022 [US2] Route `src/app/api/pacientes/[id]/adequacao/route.ts` (GET; source=plano; gate `dieta`; RBAC; idade/sexo/estado do cadastro com override)
- [ ] T023 [US2] Painel de adequação na tela de Plano Alimentar (client): tabela por nutriente (total × DRI × % × classe), destaque de carências/excessos, ajuste de idade/sexo/estado

**Checkpoint**: US1 + US2 funcionam de forma independente.

---

## Phase 5: User Story 3 - Recordatório alimentar (R24h) (Priority: P3)

**Goal**: registrar o consumo real de um dia, com totais ao vivo + análise de adequação; histórico por paciente.

**Depende de**: US1 (soma c/ micros); reusa US2 (adequação).

**Independent Test**: com `nutri_recordatorio` ligado, montar um recordatório de um dia, ver totais, salvar, reabrir histórico e rodar a adequação.

### Tests (US3)

- [ ] T024 [P] [US3] Contract/RBAC test: gate `nutri_recordatorio` (404 desligado) + papéis `admin`/`profissional_saude`, em `tests/contract/recordatorio-rbac.spec.ts`
- [ ] T025 [P] [US3] Integration test: montar/salvar recordatório, totais batendo, isolamento entre tenants, em `tests/integration/recordatorio.spec.ts`

### Implementation (US3)

- [ ] T026 [US3] Migration `supabase/migrations/0183_food_recalls.sql`: `food_recalls` + `food_recall_items` (RLS por tenant, FK paciente/food, cascade) + auditoria
- [ ] T027 [US3] Domínio `src/lib/core/nutrition/recall/plan.ts`: `saveRecall`/`listRecalls`/`getRecall` reusando o motor de soma (energia+macros+micros)
- [ ] T028 [US3] Routes `src/app/api/pacientes/[id]/recordatorio/route.ts` (GET/POST; gate `nutri_recordatorio`; RBAC)
- [ ] T029 [US3] Estender `src/app/api/pacientes/[id]/adequacao/route.ts` para aceitar `source=recordatorio&ref_id=` (gate `nutri_recordatorio`)
- [ ] T030 [US3] Tela `src/app/(dashboard)/operacao/recordatorio/` (page RSC + client): seletor de paciente (com criar/prefill já existentes), montagem por refeições reusando `FoodSearch`+medidas, totais ao vivo, painel de adequação, histórico
- [ ] T031 [US3] Item de menu "Recordatório" na sidebar (`src/app/(dashboard)/_components/sidebar-sections.ts`) gated `nutri_recordatorio` + ajustar teste `tests/unit/dashboard-shell-sections.spec.ts`

**Checkpoint**: todas as histórias funcionais e independentes.

---

## Phase 6: Polish & Cross-Cutting

- [ ] T032 [P] Prescrição imutável (047): incluir micros nos totais congelados do snapshot (`diet/prescribe.ts`), aditivo — planos antigos seguem válidos
- [ ] T033 Rodar suíte completa (`pnpm typecheck`, `pnpm lint:auth`, `pnpm test`) e re-seedar o local (`seed:demo` + `seed:foods-micros` + `seed:dris`)
- [ ] T034 [P] Atualizar `CLAUDE.md`/docs da vertical de nutrição com micros/DRIs/recordatório
- [ ] T035 Rodar o roteiro de `specs/049-micronutrientes-dri-recordatorio/quickstart.md`
- [ ] T036 (humano) Validar fidelidade dos micros/DRIs com a nutricionista — amostras contra a planilha (análogo ao T047 da 047)

---

## Dependencies & Execution Order

- **Setup (Phase 1)** → sem dependência.
- **Foundational (Phase 2)** → depende do Setup; **bloqueia US1/US2/US3**.
- **US1 (Phase 3)** → depende do Foundational. **MVP.**
- **US2 (Phase 4)** → depende de US1 (micros nos totais).
- **US3 (Phase 5)** → depende de US1; reusa US2 (adequação).
- **Polish (Phase 6)** → depende das histórias desejadas.

### Paralelismo

- Setup: T003 [P].
- Foundational: T007 [P] após T006.
- US1: T008/T009 [P] (testes); T012/T013 [P] (arquivos distintos).
- US2: T016/T017 [P]; T020 [P].
- US3: T024/T025 [P].
- Entre histórias: com equipe, US2 e US3 podem andar em paralelo após US1 (ambas dependem só dela).

---

## Implementation Strategy

### MVP (US1)
1. Setup → 2. Foundational → 3. US1 → **validar isolada** (buscar alimento c/ micros, plano somando micros) → deploy.

### Entrega incremental
US1 (micros) → US2 (adequação, o valor clínico) → US3 (recordatório). Cada uma agrega valor sem quebrar a anterior. Deploy: migrations auto-aplicam no push (integração Supabase); confirmar com `supabase migration list --linked`.

## Notes

- [P] = arquivos diferentes, sem dependência pendente.
- Sem novas dependências (aritmética pura, motor isomórfico).
- Fidelidade clínica dos valores (micros/DRIs) = polish com a nutricionista, análogo ao T047 da 047.
- Reuso máximo de 046/047: motor de soma, busca de alimentos, medidas caseiras, seletor de paciente (com criação/prefill já entregues), gating por módulo, RLS.

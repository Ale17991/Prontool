---
description: "Task list — Plano Alimentar (feature 047)"
---

# Tasks: Plano Alimentar

**Input**: Design documents from `/specs/047-plano-alimentar/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: INCLUÍDOS — a Constituição (Quality Gates, Seção 3) exige, para features que tocam acesso multi-tenant, testes de (a) imutabilidade, (b) isolamento entre tenants e (c) autorização por papel. Somam-se testes de unidade do motor de soma (SC-002 exige "números batendo").

**Organization**: por história de usuário (US1–US4). US1 (base de alimentos) é a fundação real de tudo o mais.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: paralelizável (arquivos distintos, sem dependência pendente)
- **[Story]**: US1–US4; Setup/Foundational/Polish sem label

---

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 [P] Criar diretórios `src/lib/core/nutrition/diet/` e `src/lib/core/nutrition/foods/` com barrels `index.ts` vazios
- [X] T002 [P] `scripts/build-foods-seed.ts` — normaliza os 3 CSVs (POF composição, TACO, medidas POF), deriva energia por Atwater, mapeia grupo, e injeta o seed (INSERT em lote, staging por external_code) na migration 0176. **2568 alimentos (597 TACO + 1971 POF) + 11801 medidas.**
- [X] T003 [P] Grupos alimentares (11) seedados na própria migration; TACO mapeada por `categoria`, POF em `outros` (refinar depois — US3 usa listas curadas)

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: nenhuma história começa antes desta fase.

- [X] T004 Migration `supabase/migrations/0176_food_catalog_and_diet_plan.sql` — parte 1: `CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions` + wrapper `IMMUTABLE` `public.immutable_unaccent(text)` para permitir índice (ver research D5)
- [X] T005 Migration 0176 — parte 2: tabelas `food_groups`, `foods`, `food_household_measures`, `food_equivalence_lists`, `food_equivalence_items` conforme `data-model.md` (colunas, `NUMERIC` para nutrientes, CHECKs de plausibilidade, `tenant_id NULL` = global)
- [X] T006 Migration 0176 — parte 3: índices (`(tenant_id, active, name)`, GIN trigram sobre `immutable_unaccent(lower(name))`, `UNIQUE (source, external_code) WHERE tenant_id IS NULL`) + RLS padrão 0123 (SELECT global-ou-próprio; escrita `admin`/`profissional_saude` do tenant) + trigger anti-escrita nas linhas globais
- [X] T007 Migration 0176 — parte 4: `ALTER TABLE diet_plans` (`status`, `assessment_id`, `target_kcal`, `target_macros`) e `ALTER TABLE diet_meal_items` (`food_id`, `grams`, `measure_label`, `measure_qty`, `equivalence_list_id`, `snap_*`), todas aditivas/nullable
- [X] T008 Migration 0176 — parte 5: `diet_plan_prescriptions` (append-only) — tabela + `enforce_append_only` (BEFORE UPDATE/DELETE) + `REVOKE UPDATE,DELETE FROM authenticated` + RLS + trigger `AFTER INSERT` de auditoria (`log_audit_event`) + índice `(tenant_id, patient_id, prescribed_at DESC)`
- [X] T009 Migration 0176 — parte 6: seed do catálogo global via `COPY` (grupos → foods → medidas → listas de equivalência de fábrica) a partir de `supabase/seed-data/foods/`; energia derivada por Atwater onde ausente
- [X] T010 Migration 0176 — parte 7: registrar `food_groups`, `foods`, `food_household_measures`, `food_equivalence_lists`, `food_equivalence_items` no mecanismo `catalog_baseline` (captura na 1ª chamada + refresh se já existir), espelhando o que a 0175 fez (gotcha da 0170 — research D3)
- [X] T011 Rodar `pnpm supabase:reset && pnpm supabase:gen-types`; conferir tipos gerados em `src/lib/db/generated`; validar contagem do catálogo (~2.500 alimentos, ~11.800 medidas)
- [ ] T012 [P] `scripts/seed-foods.ts` + script `seed:foods` / `seed:foods:prod` no `package.json` — reingestão idempotente do catálogo global (por `source`+`external_code`) para aplicar em produção sem depender do reset

**Checkpoint**: schema, catálogo global, imutabilidade e baseline prontos — histórias podem começar.

---

## Phase 3: User Story 1 - Base de alimentos utilizável (Priority: P1) 🎯 MVP

**Goal**: catálogo consultável (global + próprio da clínica) com nutrientes, grupo, porção e medida caseira; cadastro de alimento próprio com Atwater e plausibilidade.

**Independent Test**: buscar alimento da base e ver nutrientes; cadastrar próprio com porção/macros e confirmar que fica só para a clínica; energia derivada quando ausente.

### Tests for US1 ⚠️

- [X] T013 [P] [US1] Contract test `tests/contract/foods-tenant-isolation.spec.ts` — catálogo global legível por dois tenants; alimento próprio do tenant A invisível ao B; nenhum tenant edita/insere linha global (gate b)
- [X] T014 [P] [US1] Contract test `tests/contract/foods-rbac.spec.ts` — `POST/PATCH/DELETE /api/alimentos` só `admin`/`profissional_saude`; recepcionista/financeiro negados; sem módulo `dieta` → negado (gate c)
- [X] T015 [P] [US1] Unit test `tests/unit/nutrition-food-atwater.spec.ts` — energia derivada `4P+4C+9L` quando ausente; plausibilidade (energia 0–1000/100g, macros 0–100/100g) rejeita valores absurdos

### Implementation for US1

- [X] T016 [P] [US1] `src/lib/core/nutrition/foods/atwater.ts` — derivação de energia + validação de plausibilidade (puro, reusável no cliente e servidor)
- [X] T017 [US1] `src/lib/core/nutrition/foods/search.ts` — busca escopada (global + próprio do tenant) com `immutable_unaccent`/trigram, filtro por grupo e `scope`
- [X] T018 [US1] `src/lib/core/nutrition/foods/custom.ts` — criar/editar/desativar alimento próprio (Atwater na ausência de energia; grava `source:'custom'` + `tenant_id` da sessão; medidas caseiras)
- [X] T019 [US1] Rota `src/app/api/alimentos/route.ts` — `GET` busca + `POST` alimento próprio (`requireRole` escrita, gate `hasModule('dieta')`, Zod conforme contrato §1/§2)
- [X] T020 [US1] Rota `src/app/api/alimentos/[id]/route.ts` — `PATCH`/`DELETE` (desativação lógica) de alimento próprio; nega sobre linha global (contrato §3)
- [X] T021 [US1] Rota `src/app/api/alimentos/grupos/route.ts` — `GET` grupos + listas de substituição visíveis à clínica (contrato §4)
- [X] T022 [US1] Tela `src/app/(dashboard)/configuracoes/alimentos/page.tsx` (RSC, gate `hasModule('dieta')`) + client de busca/cadastro; card "Alimentos" no hub de Configurações (`_cards.ts`) — **exibe a fonte de cada alimento e a atribuição TACO/IBGE** (FR-020/SC-008)
- [X] T023 [US1] Integration test `tests/integration/diet-food-catalog.spec.ts` — buscar global; cadastrar próprio; energia derivada; próprio isolado; global não editável

**Checkpoint**: US1 funcional — a clínica tem catálogo nutricional consultável e cadastra os próprios alimentos.

---

## Phase 4: User Story 2 - Cardápio com cálculo automático (Priority: P1) 🎯 MVP

**Goal**: montar plano por refeições/itens, somar energia e macros por refeição e por dia ao vivo, comparar com a meta da avaliação (046), e prescrever gerando versão imutável.

**Independent Test**: criar plano com refeições/itens; totais batem com a soma; comparação com a meta aparece quando há avaliação; prescrever congela o retrato.

### Tests for US2 ⚠️

- [X] T024 [P] [US2] Unit test `tests/unit/nutrition-diet-totals.spec.ts` — item→nutrientes por regra de três sobre `reference_grams`; conversão medida caseira→gramas; soma por refeição/dia; delta vs meta; **números batem exatamente** (SC-002)
- [X] T025 [P] [US2] Contract test `tests/contract/diet-prescription-immutability.spec.ts` — `diet_plan_prescriptions` rejeita UPDATE/DELETE; plano prescrito não muda quando o alimento de origem é editado (gate a / SC-004)
- [X] T026 [P] [US2] Contract test `tests/contract/diet-plan-rbac.spec.ts` — criar/editar/prescrever plano só `admin`/`profissional_saude`; sem módulo → negado (gate c)

### Implementation for US2

- [X] T027 [P] [US2] `src/lib/core/nutrition/diet/totals.ts` — motor puro isomórfico: nutrientes do item, totais por refeição/dia, delta vs meta (`target_kcal`/`target_macros`)
- [X] T028 [US2] `src/lib/core/nutrition/diet/plan.ts` — montar/editar rascunho (upsert do cardápio inteiro; converte medida caseira→gramas na persistência; grava `food` = nome do alimento no momento)
- [X] T029 [US2] `src/lib/core/nutrition/diet/prescribe.ts` — operação atômica: calcula e grava `snap_*`, copia meta vigente de `nutrition_assessments`, insere `diet_plan_prescriptions` (snapshot JSONB), marca `status='prescrito'` (transação única)
- [X] T030 [US2] Rota `src/app/api/pacientes/[id]/plano-alimentar/route.ts` — `GET` plano vigente + meta + delta; `POST`/`PATCH` rascunho (contrato §5/§6); `409` ao editar plano prescrito
- [X] T031 [US2] Rota `src/app/api/pacientes/[id]/plano-alimentar/prescrever/route.ts` — `POST` prescreve (contrato §7)
- [X] T032 [US2] Tela `src/app/(dashboard)/operacao/plano-alimentar/page.tsx` (RSC, gate) + `plan-builder-client.tsx` + `_components/{food-typeahead,meal-editor,totals-panel}.tsx` — cardápio, totais ao vivo (motor no cliente), comparação com a meta, botão Prescrever
- [X] T033 [US2] Item de menu "Plano Alimentar" na sidebar (`sidebar-sections.ts`), em Operação, gated `hasModule('dieta')` + papel de escrita — **atualizar `tests/unit/dashboard-shell-sections.spec.ts`** (a lista de itens muda)
- [X] T034 [P] [US2] Integration test `tests/integration/diet-plan-build-and-prescribe.spec.ts` — montar → total confere → prescrever → snapshot criado + `status` prescrito + auditoria; plano sem avaliação monta sem delta (edge case)

**Checkpoint**: US1+US2 = MVP — a clínica monta o cardápio, vê a comparação com a meta e prescreve.

---

## Phase 5: User Story 3 - Grupos e substituições (Priority: P2)

**Goal**: listas de substituição por grupo (o "OU") disponíveis como opções equivalentes no cardápio.

**Independent Test**: definir porção equivalente e alimentos de um grupo; usar no cardápio e ver as opções "ou".

- [X] T035 [P] [US3] Integration test `tests/integration/diet-equivalence.spec.ts` — criar lista de substituição da clínica; associar itens; item do cardápio vinculado à lista expõe as opções equivalentes; isolamento (lista própria não vaza)
- [X] T036 [US3] `src/lib/core/nutrition/foods/equivalence.ts` — CRUD de grupos (leitura) e de listas/itens de substituição por clínica (escrita)
- [X] T037 [US3] Estender `src/app/api/alimentos/grupos/route.ts` — `POST`/`PATCH`/`DELETE` de listas de substituição próprias (RBAC + gate)
- [X] T038 [US3] UI: no `meal-editor` marcar um item como pertencente a uma lista de substituição e exibir as opções "ou"; gestão de listas na tela de Configurações → Alimentos

**Checkpoint**: US3 funcional — cardápio com flexibilidade de substituição.

---

## Phase 6: User Story 4 - Entregar o plano ao paciente (Priority: P2)

**Goal**: plano prescrito visível no portal do paciente + versão para impressão/compartilhamento.

**Independent Test**: prescrever e confirmar que o paciente vê no portal exatamente o prescrito; gerar versão de impressão.

- [X] T039 [P] [US4] Integration test `tests/integration/diet-portal-delivery.spec.ts` — prescrição → portal lê o snapshot mais recente; rascunho não aparece; conteúdo == prescrito (SC-007)
- [X] T040 [US4] Estender `src/lib/core/patient-portal/diet.ts` — passar a ler `diet_plan_prescriptions.snapshot` (prescrição vigente) em vez do rascunho
- [X] T041 [US4] Estender `src/components/patient-portal/plan-cards.tsx` — exibir refeições/itens/medidas/substituições/totais da prescrição (somente leitura)
- [X] T042 [US4] Versão para impressão/compartilhamento do plano prescrito — **com a atribuição das fontes (TACO/IBGE)** no rodapé (FR-016/FR-020/SC-008)

**Checkpoint**: US4 funcional — paciente recebe o plano.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T043 [P] Revisar textos/labels (grupos, medidas caseiras, mensagens de plausibilidade e de plano prescrito) para consistência
- [ ] T044 Rodar `pnpm lint:auth`, `pnpm typecheck`, `pnpm test` e o roteiro de `quickstart.md`; garantir os testes do motor de soma verdes
- [ ] T045 Re-seed pós-testes (`seed:demo`); confirmar que o catálogo de alimentos sobrevive ao reset via `catalog_baseline` (gotcha 0170)
- [ ] T046 [P] Atualizar `CLAUDE.md`/docs com a decisão de fontes (POF+TACO, TBCA descartada) e o passo pendente de confirmar a licença do IBGE
- [ ] T047 [P] Validar amostra de alimentos e de um plano real com a nutricionista (SC-002 na prática) — a homologação clínica que os testes não cobrem

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (F1)** → **Foundational (F2)** bloqueia todas as histórias.
- **US1 (F3)** depende de F2 — é a fundação: sem base de alimentos, não há cálculo.
- **US2 (F4)** depende de F2 e de US1 (precisa de alimentos para montar o cardápio).
- **US3 (F5)** depende de US1/US2 (substituições sobre a base e o cardápio).
- **US4 (F6)** depende de US2 (só entrega o que foi prescrito).
- **Polish (F7)** após as histórias desejadas.

### User Story Dependencies

- **US1** é independente e entrega valor sozinha (catálogo consultável).
- **US2** consome US1. É o coração do módulo.
- **US3** e **US4** são incrementos sobre US1+US2.

### Parallel Opportunities

- Setup: T001–T003 em paralelo.
- Foundational: a migration 0176 (T004–T009) é sequencial (mesmo arquivo); T012 em paralelo depois de T011.
- US1: testes T013–T015 em paralelo; `atwater.ts` (T016) independe das rotas.
- US2: T024–T026 (testes) em paralelo; `totals.ts` (T027) independe de `plan.ts`/`prescribe.ts`.

---

## Implementation Strategy

### MVP (US1 + US2)

1. F1 Setup → 2. F2 Foundational (migration + catálogo + baseline) → 3. US1 (base) + US2 (cardápio+prescrição).
4. **PARAR e VALIDAR**: montar um cardápio real, conferir que os totais batem (SC-002) e que a comparação com a meta da 046 aparece.
5. Demo.

### Incremental

- +US3 (substituições) → +US4 (entrega no portal) → Polish.

### Notas

- Motor de soma (T024/T027) é o coração da correção — escrever o teste antes.
- `vitest` apaga o banco; o catálogo de alimentos é restaurado pelo `catalog_baseline` (T010) — se sumir após a suíte, é o gotcha da 0170.
- Não violar imutabilidade da prescrição (correção = nova versão), RBAC, gate de módulo, nem a atribuição das fontes (é licença, FR-020).
- A licença do IBGE segue **não confirmada** (research D1) — confirmar antes de clientes que auditam fornecedor.

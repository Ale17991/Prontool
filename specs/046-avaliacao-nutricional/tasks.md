---
description: "Task list — Avaliação Nutricional (feature 046)"
---

# Tasks: Avaliação Nutricional

**Input**: Design documents from `/specs/046-avaliacao-nutricional/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: INCLUÍDOS — a Constituição (Quality Gates) exige testes de contrato de imutabilidade, isolamento multi-tenant e RBAC; e o SC-002 (números batendo) exige testes de unidade das equações/protocolos vs. gabarito (`nutri-doc/formulas-referencia.md`).

**Organization**: por história de usuário (US1–US4). O motor de cálculo é a fundação de US1/US2.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: paralelizável (arquivos distintos, sem dependência pendente)
- **[Story]**: US1–US4; Setup/Foundational/Polish sem label

---

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 [P] Criar diretórios `src/lib/core/nutrition/` e `src/lib/core/nutrition/assessments/` + barrel `src/lib/core/nutrition/index.ts`
- [X] T002 [P] `src/lib/core/nutrition/age-sex.ts` — idade a partir do nascimento; guardas de faixa etária/sexo dos protocolos/equações
- [X] T003 [P] `src/lib/core/nutrition/protocols.ts` — catálogo (metadados) dos 10 protocolos de dobras e das 16 equações de TMB: slug, rótulo, sítios de dobra exigidos, faixa etária/sexo válidos, se usa MLG (fonte: `nutri-doc/formulas-referencia.md`). Reusado no cliente para montar o formulário.

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: nenhuma história começa antes desta fase.

- [ ] T004 Migration `supabase/migrations/0175_nutrition_assessments.sql`: tabela `nutrition_assessments` (colunas de entrada + resultado conforme data-model), índice `(tenant_id, patient_id, assessed_at DESC)`, CHECKs de faixa plausível, RLS (SELECT `jwt_tenant_id()`; INSERT admin/profissional_saude), REVOKE UPDATE/DELETE de `authenticated`
- [ ] T005 Migration 0175: trigger append-only (rejeita UPDATE/DELETE fora de superuser) + trigger `AFTER INSERT` de auditoria (`log_audit_event`)
- [ ] T006 Migration 0175: RPC `create_nutrition_assessment(...)` SECURITY DEFINER (grava o snapshot; valida tenant via `jwt_tenant_id()`; retorna id)
- [ ] T007 Migration 0175: seed da métrica `gasto_energetico_total` (kcal, specialty `nutricao`) em `patient_metric_types` **e** no `catalog_baseline.patient_metric_types` (gotcha da 0170 — sobreviver ao reset dos testes)
- [ ] T008 Rodar `pnpm supabase:reset && pnpm supabase:gen-types`; conferir tipos em `src/lib/db/generated`; re-seed (`seed:demo` + métricas de nutrição)
- [X] T009 [P] `src/lib/core/nutrition/classify.ts` — classificação de IMC (OMS + cutoffs de idoso) e de RCQ (risco por sexo)
- [ ] T010 `src/lib/core/nutrition/assessments/create.ts` — orquestra: valida paciente/tenant e dados obrigatórios (sexo/idade), chama o motor (blocos de composição/energia conforme presentes), grava via RPC e lança os derivados com `recordMeasurementsBatch` (mesma `assessed_at`)
- [ ] T011 [P] `src/lib/core/nutrition/assessments/{list,get}.ts` — leitura escopada por paciente/tenant
- [ ] T012 Rota `src/app/api/pacientes/[id]/avaliacao-nutricional/route.ts` — `POST` (criar) + `GET` (listar) com `requireRole` + gate `hasModule('nutri_avaliacao')` + Zod (contrato em `contracts/`)
- [ ] T013 Sidebar + rota: item de menu e página `src/app/(dashboard)/operacao/avaliacao-nutricional/page.tsx` gated por `hasModule('nutri_avaliacao')` (nega acesso direto sem módulo) — shell com seleção de paciente e painel de resultado vazio
- [ ] T014 [P] Contract test `tests/contract/nutrition-assessment-immutability.spec.ts` — `nutrition_assessments` rejeita UPDATE e DELETE
- [ ] T015 [P] Contract test `tests/contract/nutrition-assessment-tenant-isolation.spec.ts` — tenant B não lê/insere avaliação do tenant A
- [ ] T016 [P] Contract test `tests/contract/nutrition-assessment-rbac.spec.ts` — rota: admin/profissional_saude criam (201); recepcionista/financeiro 403; sem módulo → negado

**Checkpoint**: schema, persistência, gating e rota prontos — histórias podem começar.

---

## Phase 3: User Story 1 - Composição corporal por dobras (Priority: P1) 🎯 MVP

**Goal**: calcular %gordura, massa gorda/magra, IMC e RCQ a partir de dobras/circunferências, salvar e alimentar a evolução.

**Independent Test**: escolher protocolo, informar dobras/medidas, conferir resultados vs. referência; salvar e ver os derivados no histórico de medições.

### Tests for US1 ⚠️

- [X] T017 [P] [US1] Unit test `tests/unit/nutrition-body-composition.spec.ts` — cada um dos 10 protocolos: Σdobras+idade → Dc → %gordura (Siri) → massa gorda/magra, vs. gabarito gerado de `nutri-doc/formulas-referencia.md` (escrever FALHANDO antes)
- [X] T018 [P] [US1] Unit test `tests/unit/nutrition-classify.spec.ts` — classificação de IMC e RCQ por faixas/sexo
- [ ] T019 [P] [US1] Integration test `tests/integration/nutrition-assessment-composition.spec.ts` — salvar avaliação com composição → snapshot imutável + derivados (%gordura, massa magra/gorda, IMC) lançados nas medições

### Implementation for US1

- [X] T020 [US1] `src/lib/core/nutrition/body-composition.ts` — 10 protocolos (Durnin-Womersley, Guedes, JP-Ward 3D, JP-Ward 7D, Petroski, Faulkner, Weltman, McArdle, Slaughter, bioimpedância) → densidade → Siri → massa gorda/magra; IMC; RCQ. Coeficientes de `formulas-referencia.md`
- [ ] T021 [US1] Estender `assessments/create.ts` para computar e gravar o **bloco de composição** e seus derivados
- [ ] T022 [US1] UI: bloco de Antropometria em `src/app/(dashboard)/operacao/avaliacao-nutricional/_components/composition-form.tsx` — campos de dobra conforme o protocolo (via `protocols.ts`) + circunferências + peso/altura, com **resultado ao vivo** (motor puro no cliente)
- [ ] T023 [US1] Validações: sítios exigidos pelo protocolo, compatibilidade protocolo↔idade, faixas plausíveis (mensagens 422 claras)

**Checkpoint**: US1 funcional — a clínica registra composição corporal e vê a evolução.

---

## Phase 4: User Story 2 - Necessidades energéticas (TMB → GET → macros) (Priority: P1) 🎯 MVP

**Goal**: calcular TMB por equação, GET (atividade/injúria/gestante), VET-meta e macros; salvar e alimentar a evolução.

**Independent Test**: informar dados + equação + atividade + objetivo, conferir TMB/GET/VET/macros vs. referência.

### Tests for US2 ⚠️

- [X] T024 [P] [US2] Unit test `tests/unit/nutrition-energy.spec.ts` — as 16 equações de TMB (coeficientes canônicos onde a planilha divergia — ver decisões em `formulas-referencia.md`), PAL, injúria, adicional gestante/lactante, GET, VET-meta e macros, vs. gabarito (escrever FALHANDO antes)

### Implementation for US2

- [X] T025 [US2] **Reconferir a EER/IOM 2005 célula a célula** nas planilhas (parentização de PA sobre peso+altura e o termo aditivo `+107/+144`) e registrar a forma final em `formulas-referencia.md` antes de codá-la
- [X] T026 [US2] `src/lib/core/nutrition/energy.ts` — 16 equações de TMB, fator de atividade (PAL), fator injúria, adicional gestante/lactante → GET; VET-meta por objetivo (déficit/manutenção/superávit); macros (por % e por g/kg)
- [ ] T027 [US2] Estender `assessments/create.ts` para computar e gravar o **bloco de energia** e seus derivados (TMB, GET)
- [ ] T028 [US2] UI: bloco de Gasto energético em `src/app/(dashboard)/operacao/avaliacao-nutricional/_components/energy-form.tsx` — equação + atividade + injúria/gestante + objetivo + macros, com **resultado ao vivo**
- [ ] T029 [P] [US2] Integration test `tests/integration/nutrition-assessment-energy.spec.ts` — salvar com energia → TMB/GET nas medições; equação por MLG sem composição → 422 orientando
- [ ] T030 [US2] Validações: equação por MLG exige composição; macros somam 100%; faixas plausíveis

**Checkpoint**: US1+US2 = MVP — avaliação completa (composição + energia) salva e visível na evolução.

---

## Phase 5: User Story 3 - Histórico e evolução (Priority: P2)

**Goal**: listar avaliações anteriores e ver a evolução dos indicadores.

**Independent Test**: com 2+ avaliações, abrir o histórico e conferir lista ordenada + evolução nos gráficos.

- [ ] T031 [P] [US3] Integration test `tests/integration/nutrition-assessment-history.spec.ts` — 2+ avaliações → `list` ordenado (mais recente primeiro) + série dos derivados nas medições
- [ ] T032 [US3] UI: histórico de avaliações (lista com data, protocolo/equação, principais resultados) na tela `avaliacao-nutricional`
- [ ] T033 [US3] UI: evolução — reusar os gráficos de medições existentes (`MetricEvolutionChart`) para os derivados de nutrição

**Checkpoint**: US3 funcional — acompanhamento ao longo do tempo.

---

## Phase 6: User Story 4 - Metas do paciente (Priority: P3)

**Goal**: definir e exibir metas (peso-alvo, %gordura-alvo) + meta de VET/macros.

**Independent Test**: definir peso-alvo e %gordura-alvo e conferir que aparecem junto da evolução.

- [ ] T034 [US4] UI: definição de metas (peso-alvo, %gordura-alvo) reusando `patient_metric_goals` (componente `GoalsEditor` existente) na tela
- [ ] T035 [US4] Exibir a meta de VET/macros da última avaliação junto da evolução

**Checkpoint**: US4 funcional.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T036 [P] Revisar textos/tooltips (nomes de protocolos/equações, mensagens de pendência) para consistência
- [ ] T037 Rodar `pnpm lint:auth`, `pnpm typecheck`, `pnpm test` e o roteiro de `quickstart.md`; garantir os testes de unidade das fórmulas verdes
- [ ] T038 Re-seed pós-testes (`seed:demo` + métricas de nutrição, incl. `gasto_energetico_total`) — os testes apagam o banco e o `catalog_baseline` restaura os catálogos
- [ ] T039 [P] Validar amostra de resultados com a nutricionista (SC-002) e, se possível, trocar os gabaritos por exemplos reais preenchidos na planilha

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (F1)** → **Foundational (F2)** bloqueia todas as histórias.
- **US1 (F3)** e **US2 (F4)** dependem de F2 (schema/persistência/rota/UI shell). São o MVP (P1).
- **US3 (F5)** depende de F2 e de existir avaliação (US1/US2).
- **US4 (F6)** depende de F2; reusa metas.
- **Polish (F7)** após as histórias desejadas.

### User Story Dependencies

- **US1** e **US2** compartilham `assessments/create.ts`, a rota e a tela (cada uma adiciona seu bloco de cálculo + bloco de formulário) — testáveis de forma independente pelo respectivo bloco.
- **US3/US4** são incrementos sobre os dados já produzidos por US1/US2.

### Parallel Opportunities

- Setup: T001–T003 em paralelo.
- Foundational: T014–T016 (contratos) em paralelo após a rota (T012); T009/T011 em paralelo.
- US1: T017/T018/T019 (testes) em paralelo; `body-composition.ts` (T020) independe de `energy.ts` (T026) → US1 e US2 podem ser tocadas em paralelo por devs distintos.

---

## Implementation Strategy

### MVP (US1 + US2)

1. F1 Setup → 2. F2 Foundational (migration + persistência + rota + contratos) → 3. US1 (composição) + US2 (energia).
4. **PARAR e VALIDAR**: avaliação completa, números batendo (SC-002), derivados na evolução.
5. Demo.

### Incremental

- +US3 (histórico/evolução) → +US4 (metas) → Polish.

### Notas

- Testes de fórmula (T017/T024) são o coração da correção — escrever FALHANDO antes de implementar o motor.
- `vitest` apaga o banco/seed e o `catalog_baseline` restaura catálogos → re-seedar métricas de nutrição após a suíte.
- Commit por tarefa ou grupo lógico. Não violar imutabilidade (correção = nova avaliação) nem RBAC/gate de módulo.

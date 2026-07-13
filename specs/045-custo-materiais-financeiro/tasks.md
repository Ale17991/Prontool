---
description: "Task list — Custo de materiais e métrica Gasto com materiais"
---

# Tasks: Custo de materiais e métrica "Gasto com materiais" no financeiro

**Input**: Design documents from `/specs/045-custo-materiais-financeiro/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: INCLUÍDOS — a constituição (§ Quality Gates) exige testes de imutabilidade, isolamento de tenant e RBAC para código financeiro/multi-tenant.

**Organization**: agrupado por história de usuário (US1–US4), cada uma testável de forma independente.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos distintos, sem dependência pendente)
- **[Story]**: US1–US4 (fases de história); Setup/Foundational/Polish sem label

---

## Phase 1: Setup (Shared Infrastructure)

- [ ] T001 [P] Criar diretórios de módulo: `src/lib/core/materials-catalog/` e stub `src/lib/core/reports/materials-cost.ts`
- [X] T002 Criar esqueleto da migration `supabase/migrations/0172_material_costs.sql` (cabeçalho com decisões D1–D6)

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: nenhuma história começa antes desta fase.

- [X] T003 Migration 0172: criar tabela `public.tenant_materials` (colunas, CHECK, índices, UNIQUE parcial ativo, RLS por `jwt_tenant_id()`) em `supabase/migrations/0172_material_costs.sql`
- [X] T004 Migration 0172: `ALTER TABLE appointment_materials` adicionar `unit_cost_cents` (NOT NULL DEFAULT 0, CHECK ≥ 0) e `material_id` (FK `tenant_materials`, nullable) + trigger de consistência de tenant do `material_id`
- [X] T005 Migration 0172: trigger de validação TUSS opcional em `tenant_materials.tuss_code` (tabela 19 vigente, reusando lógica de `check_material_tuss_table`)
- [X] T006 Migration 0172: relaxar `enforce_appointment_materials_mutation` para permitir UPDATE **apenas** de `{unit_cost_cents, material_id}`; DELETE segue proibido
- [X] T007 Migration 0172: triggers de auditoria via `log_audit_event` (`tenant_materials` created/updated/deactivated; `appointment_materials` cost_updated)
- [X] T008 Migration 0172: atualizar RPCs `attach_materials_to_appointment` e `create_appointment_with_materials` para aceitar `unit_cost_cents` + `material_id` e `tuss_code` opcional
- [X] T009 Migration 0172: RPC nova `set_appointment_material_cost(...)` (SECURITY DEFINER, column-guard, auditada, `reason` obrigatório)
- [X] T010 Rodar `pnpm supabase:reset && pnpm supabase:gen-types` e conferir tipos em `src/lib/db/types`
- [ ] T011 [P] Contract test: `appointment_materials` rejeita DELETE e UPDATE de colunas ≠ `{unit_cost_cents, material_id}` em `tests/contract/appointment-materials-immutability.test.ts`
- [ ] T012 [P] Contract test: isolamento de tenant em `tenant_materials` e `set_appointment_material_cost` em `tests/contract/materials-tenant-isolation.test.ts`
- [ ] T013 [P] Contract test: RBAC — apenas `admin`/`financeiro` criam/editam custo em `tests/contract/materials-rbac.test.ts`

**Checkpoint**: schema, RPCs e guardas prontos — histórias podem começar.

---

## Phase 3: User Story 1 - Registrar o custo dos materiais no atendimento (Priority: P1) 🎯 MVP

**Goal**: cadastrar insumo com custo e registrar o custo (snapshot) do material consumido no atendimento, com override e pendência.

**Independent Test**: cadastrar insumo → anexar N unidades → custo total congelado e imutável; editar catálogo não muda o uso passado.

### Tests for User Story 1

- [ ] T014 [P] [US1] Integration test: anexar material com custo (default do catálogo + override) e listar com `totalCostCents`/`costPending` em `tests/integration/attach-material-cost.test.ts`
- [ ] T015 [P] [US1] Integration test: completar custo pendente via `set-cost` (auditado) e imutabilidade do snapshot ao editar o catálogo em `tests/integration/material-cost-complete.test.ts`

### Implementation for User Story 1

- [X] T016 [P] [US1] Módulo catálogo: `createMaterial`/`updateMaterial`/`listMaterials` + tipos em `src/lib/core/materials-catalog/{create,update,list,index}.ts`
- [X] T017 [US1] Estender `attachMaterialsToAppointment`: `MaterialInput` ganha `unitCostCents?`/`materialId?`; repassar à RPC em `src/lib/core/appointments/materials/attach.ts`
- [X] T018 [US1] Custo no fluxo de criação: migration 0173 estende `create_appointment_with_procedures_and_materials` (RPC real do cadastro manual) + `create-manual.ts` e rotas `manual`/`etapas` carregam `material_id`/`material_name`/`unit_cost_cents`
- [X] T019 [US1] Estender `listAppointmentMaterials`: `unitCostCents`, `totalCostCents`, `costPending` em `src/lib/core/appointments/materials/list.ts`
- [X] T020 [US1] `setAppointmentMaterialCost` (chama RPC nova) em `src/lib/core/appointments/materials/set-cost.ts`
- [X] T021 [P] [US1] Rotas do catálogo: `GET`/`POST` `/api/materiais` + `PATCH /api/materiais/[id]` (Zod + `requireRole('admin'|'financeiro')`) em `src/app/api/materiais/**`
- [X] T022 [US1] Estender rota de anexar material p/ custo + `PATCH /api/atendimentos/[id]/materiais/[materialRowId]/custo` (requireRole admin/financeiro) em `src/app/api/atendimentos/[id]/materiais/**`
- [X] T023 [P] [US1] UI do seletor de material no atendimento: catálogo + insumo livre + TUSS, campo de custo (default do catálogo, override) + indicador de pendência em `src/components/atendimentos/materiais-editor.tsx`; exibição de custo/total/pendência em `atendimentos/[id]` + detail-body
- [X] T024 [US1] Quick-add de insumo reutilizável no seletor (cria no catálogo sem sair do atendimento; gate `canManageCatalog`)

**Checkpoint**: US1 funcional — a clínica já registra e vê o custo por atendimento.

---

## Phase 4: User Story 2 - "Gasto com materiais" no resultado do mês (Priority: P2)

**Goal**: linha de dedução "Gasto com materiais" no resultado operacional, sem tocar em receita/repasse.

**Independent Test**: com materiais custeados no mês, o resultado exibe a linha e o lucro cai exatamente esse valor; estornado é excluído.

### Tests for User Story 2

- [ ] T025 [P] [US2] Integration test: `sumMaterialsCost` exclui estornado + fronteira de mês (fuso do tenant); `operating-result` inclui a linha e reduz `netProfit`; `grossRevenue`/`commissions` inalterados em `tests/integration/operating-result-materials.test.ts`

### Implementation for User Story 2

- [X] T026 [US2] Agregador `sumMaterialsCost` + `materialsCostDetail` (+ `materialsCostByDoctor`/`materialsCostByPlan` p/ US3) em `src/lib/core/reports/materials-cost.ts`
- [X] T027 [US2] Estender `operating-result.ts`: `materialsCostCents` em `OperatingResultLines`, subtrair em `netProfitCents`, drilldown `materials`
- [X] T028 [P] [US2] Drilldown: página `/analise/relatorios/materiais?from=&to=` (RSC, requireRole admin/financeiro) usando `materialsCostDetail`
- [X] T029 [US2] UI: linha "Gasto com materiais" + link de detalhe no dashboard `analise/relatorios` (via `financial-report.ts` totals — deduz `operatingProfitCents`)

**Checkpoint**: US2 funcional — lucro do mês reflete o custo de material.

---

## Phase 5: User Story 3 - Margem real por profissional e por convênio (Priority: P3)

**Goal**: coluna "Gasto com materiais" nos relatórios por profissional, por convênio, mensal e nos exports.

**Independent Test**: materiais em atendimentos de 2 profissionais/convênios → cada relatório atribui o gasto corretamente; export contém a coluna.

### Tests for User Story 3

- [ ] T030 [P] [US3] Integration test: `materialsCostByDoctor`/`materialsCostByPlan` atribuem por `doctor_id`/`plan_id` e excluem estornado em `tests/integration/reports-materials-breakdown.test.ts`

### Implementation for User Story 3

- [ ] T031 [US3] `materialsCostByDoctor` + `materialsCostByPlan` em `src/lib/core/reports/materials-cost.ts`
- [ ] T032 [US3] Estender `by-professional.ts` (coluna + `netAfterMaterialsCents`) em `src/lib/core/reports/by-professional.ts`
- [ ] T033 [US3] Estender `by-plan.ts` em `src/lib/core/reports/by-plan.ts`
- [ ] T034 [US3] Estender `monthly.ts` e `financial-report.ts` em `src/lib/core/reports/{monthly,financial-report}.ts`
- [ ] T035 [P] [US3] Exports Excel: coluna em `src/lib/core/reports/{export-by-professional-excel,export-by-plan-excel,export-financial-excel}.ts`
- [ ] T036 [P] [US3] Exports PDF: coluna em `src/lib/core/reports/{export-by-professional-pdf,export-by-plan-pdf,export-financial-pdf}.tsx`
- [ ] T037 [US3] UI: coluna "Gasto com materiais" nas telas por profissional/convênio/mensal

**Checkpoint**: US3 funcional — margem real visível e exportável.

---

## Phase 6: User Story 4 - Gerenciar o catálogo de insumos (Priority: P3)

**Goal**: tela de gestão do catálogo (listar inclusive inativos, editar custo, desativar), preservando usos passados.

**Independent Test**: desativar insumo → some do seletor mas fica no histórico; editar custo → novos usos usam o novo, antigos preservam o snapshot.

### Tests for User Story 4

- [ ] T038 [P] [US4] Integration test: desativação remove do seletor e mantém histórico; edição de custo não afeta usos passados em `tests/integration/catalog-management.test.ts`

### Implementation for User Story 4

- [X] T039 [US4] Tela `/configuracoes/materiais`: listar (incl. inativos), criar, editar custo/nome, desativar/reativar em `page.tsx` + `materiais-table.tsx`
- [X] T040 [US4] Entrada no hub de configurações ("Materiais / Insumos") em `_cards.ts` (gate admin/financeiro)

**Checkpoint**: US4 funcional — catálogo mantido ao longo do tempo.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T041 [P] Unit tests: `costPending`/`totalCostCents` e fronteira de mês em `tests/unit/materials-cost.test.ts`
- [ ] T042 Rodar `pnpm lint:auth`, `pnpm typecheck` e o roteiro de `quickstart.md`
- [ ] T043 [P] Revisar textos/tooltips ("Gasto com materiais", pendência de custo) para consistência de UI

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (F1)** → **Foundational (F2)** bloqueia todas as histórias.
- **US1 (F3)** depende de F2. É o MVP.
- **US2 (F4)** e **US3 (F5)** dependem de F2 (schema/agregador); usam dados de US1 (ou seeds) para teste ponta a ponta.
- **US4 (F6)** depende do módulo de catálogo criado em US1 (T016).
- **Polish (F7)** depois das histórias desejadas.

### User Story Dependencies

- **US1 (P1)**: só depende de F2.
- **US2 (P2)**: depende de F2; independe de US3/US4.
- **US3 (P3)**: depende de F2 e do agregador (compartilha `materials-cost.ts` com US2); testável isolada.
- **US4 (P3)**: depende de T016 (módulo de catálogo).

### Parallel Opportunities

- F2: T011–T013 (testes de contrato) em paralelo após a migration aplicar (T010).
- US1: T014/T015 (testes) em paralelo; T016 e T021 e T023 em arquivos distintos (paralelizáveis); T017–T020 tocam o módulo de materiais (sequenciais entre si).
- US3: T035 (Excel) e T036 (PDF) em paralelo.
- Com time: após F2, um dev toca US1, outro adianta o agregador de US2/US3.

---

## Parallel Example: Foundational tests

```bash
# Após T010 (migration aplicada), rodar em paralelo:
Task: "Contract test imutabilidade em tests/contract/appointment-materials-immutability.test.ts"
Task: "Contract test isolamento em tests/contract/materials-tenant-isolation.test.ts"
Task: "Contract test RBAC em tests/contract/materials-rbac.test.ts"
```

---

## Implementation Strategy

### MVP First (US1)

1. F1 Setup → 2. F2 Foundational (migration + RPCs + testes de guarda) → 3. F3 US1.
4. **PARAR e VALIDAR**: registrar custo por atendimento, snapshot imutável.
5. Demonstrar (já entrega valor: histórico de custo por atendimento).

### Incremental

- +US2 → lucro do mês com gasto de materiais → demo.
- +US3 → margem por profissional/convênio + exports → demo.
- +US4 → gestão do catálogo → demo.

Cada história agrega valor sem quebrar as anteriores. D1 (não mexer em repasse) mantém `commissions`/`monthly_payouts` intocados em todas as fases.

---

## Notes

- `[P]` = arquivos distintos, sem dependência pendente.
- Verificar que os testes de contrato FALHAM antes de implementar (F2/US1).
- Commit após cada tarefa ou grupo lógico.
- Não violar D1 (custo ≠ repasse) nem o append-only (só `unit_cost_cents`/`material_id` são atualizáveis, via RPC auditada).

---

description: "Tasks for feature 011 — Cadastro de impostos e imposto por convênio"
---

# Tasks: Cadastro de Impostos e Imposto por Convênio

**Input**: Design documents from `/specs/011-cadastro-impostos/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md
**Tests**: INCLUDED — exigidos pela Constitution (§"Testes obrigatórios" para preço/faturamento/RBAC/multi-tenant) e por FR-022, FR-023, FR-024 da spec.

**Organization**: Tarefas agrupadas por user story (US1, US2, US3, US4) para entrega incremental.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Pode rodar em paralelo (arquivos distintos, sem dependência em tarefa incompleta)
- **[Story]**: Mapeia para a US — [US1] cadastrar imposto da clínica, [US2] alíquota do convênio, [US3] despesa vinculada a imposto, [US4] relatórios e dashboard
- Caminhos sempre absolutos a partir da raiz do repo (`C:\My project\...`)

## Path Conventions

App Router monolítico (Next.js 14). Mapa rápido:
- DB: `supabase/migrations/`
- Core libs: `src/lib/core/<dominio>/`
- Validação e helpers: `src/lib/validation/`, `src/lib/auth/`, `src/lib/observability/`
- API: `src/app/api/<recurso>/route.ts`
- UI: `src/app/(dashboard)/...`
- Testes: `tests/unit/`, `tests/contract/`, `tests/integration/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Pré-requisitos sem amarra a uma US específica.

- [X] T001 [P] Confirmar que `pnpm supabase:reset` e `pnpm supabase:gen-types` rodam sem erro contra o stack local atual (`supabase start`) — `quickstart.md > Setup inicial` _(verificação adiada para T011 após escrever a migration; comando é destrutivo localmente — usuário rodará após review)_
- [X] T002 [P] Conferir que branch `011-cadastro-impostos` está rebased sobre `master` e que `.specify/feature.json` aponta para `specs/011-cadastro-impostos` (já feito no `/speckit-specify`, somente verificar) ✓ branch correto, feature.json aponta certo

**Checkpoint**: ambiente local pronto para receber a migration nova.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: schema novo, helpers compartilhados e RBAC. **Tudo aqui deve estar verde antes de qualquer US começar** — todas as US dependem da migration 0076 e do helper de conversão bps.

**⚠️ CRITICAL**: Não iniciar nenhuma das fases 3–6 antes do checkpoint desta fase.

### Database schema (single migration)

- [X] T003 Criar arquivo `supabase/migrations/0076_taxes_and_plan_tax_rate.sql` contendo (em ordem): (a) `CREATE TABLE public.taxes` com colunas, CHECKs (rate_bps 0..10000, name 1..80, description 1..500, category enum) e RLS habilitado conforme `data-model.md > Entidade 1`; (b) `CREATE UNIQUE INDEX taxes_active_name_unique_idx ON public.taxes (tenant_id, lower(trim(name))) WHERE deleted_at IS NULL`; (c) `CREATE INDEX taxes_tenant_active_idx ON public.taxes (tenant_id, is_active) WHERE deleted_at IS NULL`
- [X] T004 No mesmo arquivo `supabase/migrations/0076_taxes_and_plan_tax_rate.sql`: adicionar `FUNCTION enforce_taxes_mutation()` + trigger `taxes_immutable_columns BEFORE UPDATE` + trigger `taxes_no_physical_delete BEFORE DELETE` reusando `enforce_append_only` (existente). Conferir bloqueio de mutação em `id`, `tenant_id`, `name`, `category`, `created_at`, `created_by`.
- [X] T005 No mesmo arquivo `supabase/migrations/0076_taxes_and_plan_tax_rate.sql`: adicionar `FUNCTION audit_taxes_change()` + trigger `taxes_audit AFTER INSERT OR UPDATE` chamando `log_audit_event` para cada coluna mutada (rate_bps, description, is_active, deleted_at) + evento de criação
- [X] T006 No mesmo arquivo `supabase/migrations/0076_taxes_and_plan_tax_rate.sql`: criar RLS policies `taxes_read` (SELECT por tenant), `taxes_insert` (admin/financeiro), `taxes_update` (admin/financeiro) + `GRANT SELECT,INSERT ON public.taxes TO authenticated` + `GRANT UPDATE (rate_bps, description, is_active, deleted_at, deleted_by) ON public.taxes TO authenticated` + `REVOKE DELETE ON public.taxes FROM authenticated`
- [X] T007 No mesmo arquivo `supabase/migrations/0076_taxes_and_plan_tax_rate.sql`: `ALTER TABLE public.health_plans ADD COLUMN tax_rate_bps INT NOT NULL DEFAULT 0 CHECK (tax_rate_bps BETWEEN 0 AND 10000)` + `FUNCTION audit_health_plan_tax_rate_change()` + trigger `health_plans_tax_rate_audit AFTER UPDATE OF tax_rate_bps ON public.health_plans`
- [X] T008 No mesmo arquivo `supabase/migrations/0076_taxes_and_plan_tax_rate.sql`: `ALTER TABLE public.expenses ADD COLUMN tax_id UUID NULL REFERENCES public.taxes(id) ON DELETE RESTRICT` + `ADD CONSTRAINT expenses_tax_link_requires_impostos_category CHECK (tax_id IS NULL OR category='impostos')` + `CREATE INDEX expenses_tax_idx ON public.expenses (tenant_id, tax_id) WHERE tax_id IS NOT NULL`
- [X] T009 No mesmo arquivo `supabase/migrations/0076_taxes_and_plan_tax_rate.sql`: `CREATE OR REPLACE FUNCTION enforce_expenses_mutation()` que reescreve a função existente para incluir `tax_id` na lista de colunas imutáveis (mantendo as outras como na 0028); e `FUNCTION enforce_expenses_tax_same_tenant()` + trigger `expenses_tax_same_tenant BEFORE INSERT ON public.expenses` para bloquear cross-tenant via `tax_id`
- [X] T010 No mesmo arquivo `supabase/migrations/0076_taxes_and_plan_tax_rate.sql`: linha final `NOTIFY pgrst, 'reload schema';` (padrão já visto em migrations 0048)
- [X] T011 Migration aplicada via `pnpm supabase:reset` (todas as 76 migrations rerodaram limpas); `pnpm supabase:gen-types` regenerou `src/lib/db/generated/types.ts` incluindo `taxes`, `health_plans.tax_rate_bps`, `expenses.tax_id`. `pnpm typecheck` verde.

### Shared helpers and RBAC

- [X] T012 [P] Criar `src/lib/validation/rate-bps.ts` com 3 funções puras: `percentToBps(input: string): number` (parse pt-BR com vírgula, half-up arredondamento para 2 casas; aceita "6,5", "6,50", "6.50", "6"), `bpsToPercent(bps: number): string` (formata "6,50"), `bpsValid(bps: number): boolean` (int, 0..10000). Sem dependências externas
- [X] T013 [P] Criar `tests/unit/rate-bps.spec.ts` cobrindo: parsing pt-BR ("6,50"→650), parsing en-US ("6.50"→650), half-up ("6,505"→651), edge cases (negativos rejeitados, > 100% rejeitados, NaN rejeitado, vazio rejeitado), simetria roundtrip de inteiros. Roda em vitest puro _(naming `.spec.ts` para casar com vitest.config.ts include)_
- [X] T014 Atualizar `src/lib/auth/rbac.ts`: adicionar tipos `'tax.read' | 'tax.write'` ao union `Action`; adicionar `'tax.read', 'tax.write'` ao MATRIX.admin; `'tax.read', 'tax.write'` ao MATRIX.financeiro; `'tax.read'` ao MATRIX.recepcionista; `'tax.read'` ao MATRIX.profissional_saude. ✓ `pnpm typecheck` passou

**Checkpoint**: migration aplicada localmente, helpers + RBAC compilam, types gerados. Foundation está pronta para US1–US4 começarem em paralelo.

---

## Phase 3: User Story 1 — Cadastrar impostos da clínica (Priority: P1) 🎯 MVP

**Goal**: admin/financeiro consegue criar/listar/editar/desativar impostos da clínica em `Análise → Despesas → Impostos`. Recepcionista/profissional_saude veem em modo leitura. CRUD com audit + RLS + immutability triggers.

**Independent Test**: ver `spec.md > US1 Independent Test` — cadastrar "ISS" 5%, listar, editar para 5,5%, desativar; recepcionista vê listagem sem botões de escrita.

### Tests for User Story 1 ⚠️

> **NOTE**: escrever os testes antes da implementação; eles devem falhar até as rotas/triggers existirem.

- [X] T015 [P] [US1] `tests/contract/taxes-immutability.spec.ts` — UPDATE name/category → exception; rate_bps/is_active → sucesso; DELETE → exception/persist
- [X] T016 [P] [US1] `tests/contract/api-impostos-rbac.spec.ts` — matriz 4 papéis × 3 endpoints (GET 200 todos; POST/PATCH 201/200 admin+financeiro, 403 recepcionista+profissional_saude)
- [X] T017 [P] [US1] `tests/contract/api-impostos-tenant-isolation.spec.ts` — tenant A GET não retorna row do B; PATCH B retorna 404; verifica via service client que row intacto
- [X] T018 [P] [US1] `tests/contract/api-impostos-validation.spec.ts` — rate_bps -1/10001/99.9, name vazio/81 chars, category inválida → 400; rate_bps=0 e 10000 → 201
- [X] T019 [P] [US1] `tests/contract/api-impostos-duplicate.spec.ts` — "ISS" sucesso; "ISS"/"iss"/"  ISS  " duplicatas → 409 TAX_DUPLICATE; outro nome → 201
- [X] T020 [P] [US1] `tests/integration/taxes-crud.spec.ts` — CRUD completo + audit_log com `tax-created`, `tax-rate-updated`, `tax-deactivated`, `tax-reactivated`

### Implementation for User Story 1

- [X] T021 [P] [US1] `src/lib/core/taxes/create.ts` — `createTax` mapeando `23505` → `ConflictError('TAX_DUPLICATE')`
- [X] T022 [P] [US1] `src/lib/core/taxes/list.ts` — `listTaxes` filtra deleted_at, projeta `rate_percent` via `bpsToPercent`
- [X] T023 [P] [US1] `src/lib/core/taxes/update.ts` — `updateTax` valida pelo menos 1 campo, traduz erro → `NotFoundError`/`ValidationError`
- [X] T024 [US1] `src/app/api/impostos/route.ts` — GET (4 papéis) + POST (admin/financeiro), Zod schemas, `requireRole`
- [X] T025 [US1] `src/app/api/impostos/[id]/route.ts` — PATCH (admin/financeiro), refinement Zod, NotFoundError→404
- [X] T026 [P] [US1] `src/app/(dashboard)/analise/despesas/impostos/page.tsx` — SSR + tabela Nome|Alíquota|Categoria|Status|Ações
- [X] T027 [P] [US1] `src/app/(dashboard)/analise/despesas/impostos/new-tax-form.tsx` — form com Select categoria, conversão pt-BR via `percentToBps`
- [X] T028 [P] [US1] `src/app/(dashboard)/analise/despesas/impostos/tax-row-actions.tsx` — botões Editar / Desativar-Reativar
- [X] T029 [P] [US1] `src/app/(dashboard)/analise/despesas/impostos/edit-tax-form.tsx` — Dialog com nome/categoria read-only
- [X] T030 [US1] Link "Impostos cadastrados" no header de `analise/despesas/page.tsx`
- [X] T031 [US1] **78/78 testes verdes** — `pnpm typecheck` ✓, `pnpm lint:auth` ✓ (97 handlers, todos autenticam). Breakdown da suite US1: 46 unit (rate-bps) + 5 contract (imutabilidade SQL + API route p/ campos mutáveis) + 12 RBAC matrix + 2 tenant isolation + 8 validation + 4 duplicate + 1 integration CRUD com audit_log.

**Checkpoint**: US1 fully functional. Manual smoke conforme `quickstart.md > US1` deve passar. MVP entregável.

---

## Phase 4: User Story 2 — Alíquota do convênio (Priority: P1)

**Goal**: admin consegue marcar/desmarcar "Convênio cobra imposto?" e definir alíquota; persiste em `health_plans.tax_rate_bps`. Audit registra mudanças.

**Independent Test**: ver `spec.md > US2 Independent Test` — checkbox + campo controlado + persistência + audit + RBAC admin-only para escrita.

### Tests for User Story 2 ⚠️

- [X] T032 [P] [US2] `tests/contract/api-planos-tax-rate-rbac.spec.ts` — admin 200, demais papéis 403
- [X] T033 [P] [US2] `tests/contract/api-planos-tax-rate-validation.spec.ts` — bounds bps -1/10001/99.9, string, payload vazio
- [X] T034 [P] [US2] `tests/contract/api-planos-tax-rate-audit.spec.ts` — PATCH 0→650 audit_log row; idempotente NÃO duplica
- [X] T035 [P] [US2] `tests/contract/api-planos-tax-rate-tenant.spec.ts` — tenantA → planB 404; row intacto
- [X] T036 [P] [US2] `tests/integration/plan-tax-rate-flow.spec.ts` — default=0; PATCH 650→percent "6,50"; PATCH 0 zera; updatePlanTaxRate range; backward compat active

### Implementation for User Story 2

- [X] T037 [P] [US2] `src/lib/core/plans/update-tax-rate.ts` — `updatePlanTaxRate` valida range + `NotFoundError`
- [X] T038 [US2] `src/lib/core/plans/list.ts` — `.select` inclui `tax_rate_bps`; ListedPlan ganha `taxRateBps`
- [X] T039 [US2] `src/app/api/planos/[id]/route.ts` — PATCH aceita active+tax_rate_bps, devolve `tax_rate_percent`
- [X] T040 [US2] POST /api/planos mantido enxuto (sem tax_rate_bps; via PATCH posterior — decisão do research §)
- [X] T041 [P] [US2] `src/app/(dashboard)/configuracoes/convenios/[id]/plan-tax-rate-form.tsx` — checkbox + campo + read-only mode
- [X] T042 [US2] Integração em `convenios/[id]/page.tsx` — `.select` com tax_rate_bps + `<PlanTaxRateForm>`
- [X] T043 [US2] Skipped (decisão simplificadora) — criação continua mínima; alíquota via edição posterior
- [X] T044 [US2] `pnpm typecheck` ✓ + `pnpm lint:auth` ✓ + 19/19 US2 tests + regressão planos.spec/plano-recepcionista-forbidden ✓

**Checkpoint**: US2 fully functional. Manual smoke conforme `quickstart.md > US2` deve passar. Combinado com US1, MVP financeiro completo.

---

## Phase 5: User Story 3 — Despesa vinculada a imposto cadastrado (Priority: P2)

**Goal**: ao lançar despesa, admin/financeiro pode marcar "Vincular a imposto cadastrado?"; select mostra impostos ativos; ao salvar, despesa fica com `category='impostos'` e `tax_id` setado.

**Independent Test**: ver `spec.md > US3 Independent Test` — checkbox + select de impostos ativos + categoria forçada + preservação do vínculo após desativação do imposto.

### Tests for User Story 3 ⚠️

- [ ] T045 [P] [US3] `tests/contract/expenses-tax-link-category.test.ts` — POST com `tax_id` válido + `category='aluguel'` ⇒ 201, response tem `category='impostos'` (normalizada server-side)
- [ ] T046 [P] [US3] `tests/contract/expenses-tax-link-validation.test.ts` — `tax_id=uuid-aleatorio-inexistente` ⇒ 400 TAX_NOT_FOUND_OR_INACTIVE
- [ ] T047 [P] [US3] `tests/contract/expenses-tax-link-inactive.test.ts` — `tax_id` de imposto desativado ⇒ 400
- [ ] T048 [P] [US3] `tests/contract/expenses-tax-link-cross-tenant.test.ts` — sessão tenantA + tax_id de tenantB ⇒ 400 (RLS retorna 0 rows no fetchActiveTax)
- [ ] T049 [P] [US3] `tests/contract/expenses-tax-link-db-check.test.ts` — SQL direto: `INSERT INTO expenses(... category='aluguel', tax_id=X)` ⇒ violation `expenses_tax_link_requires_impostos_category`
- [ ] T050 [P] [US3] `tests/contract/expenses-tax-link-immutability.test.ts` — `UPDATE expenses SET tax_id=Y WHERE id=existing` ⇒ exception (trigger expandida)
- [ ] T051 [P] [US3] `tests/integration/expenses-tax-linkage.test.ts` — fluxo: criar imposto, criar despesa com vínculo, listar (espera `tax_name` no DTO), desativar imposto, criar nova despesa sem o imposto inativo no select, despesa antiga continua mostrando referência

### Implementation for User Story 3

- [ ] T052 [US3] Estender `src/lib/core/expenses/create.ts` com parâmetro `taxId?: string | null`. Se preenchido: (a) chama `fetchActiveTax(supabase, { tenantId, id: taxId })` que faz `SELECT id FROM public.taxes WHERE id=$1 AND tenant_id=$2 AND is_active=true AND deleted_at IS NULL`; (b) se 0 rows, lança `ValidationError('TAX_NOT_FOUND_OR_INACTIVE', ...)`; (c) força `category='impostos'` no payload de insert. Mantém tudo o resto da função atual
- [ ] T053 [US3] Estender `src/lib/core/expenses/list.ts` para fazer `.select('..., taxes:tax_id(id, name)')` (left join leve); projetar `tax_name` no DTO retornado quando `tax_id IS NOT NULL`
- [ ] T054 [US3] Estender `src/app/api/despesas/route.ts` (POST handler): adicionar `tax_id: z.string().uuid().nullable().optional()` ao Zod schema. Passar para `createExpense`. Capturar `ValidationError` ⇒ 400. (GET handler já está coberto via T053)
- [ ] T055 [P] [US3] Localizar e estender `src/app/(dashboard)/analise/despesas/new-expense-form.tsx` (criar se não existir — `analise/despesas/page.tsx` referencia este import): adicionar checkbox "Vincular a imposto cadastrado?", inicialmente desmarcado. Quando marcado: faz `fetch /api/impostos?include_inactive=false` (1x ao montar) e renderiza `Select` com opções `{id, name, rate_percent}`. Quando submete com checkbox marcado: inclui `tax_id` no payload e força `category='impostos'` na UI (campo de categoria fica disabled/oculto). Quando desmarcado: fluxo normal de categoria livre
- [ ] T056 [P] [US3] Estender `src/app/(dashboard)/analise/despesas/page.tsx` para exibir `tax_name` na coluna Descrição (subtitle) quando a despesa tem vínculo — apenas se `e.tax_id != null` mostra "Imposto: ISS" abaixo da descrição
- [ ] T057 [US3] Rodar `pnpm lint:auth`, `pnpm typecheck` e `pnpm test tests/contract/expenses-tax-link-*.test.ts tests/integration/expenses-tax-linkage.test.ts`

**Checkpoint**: US3 fully functional. Manual smoke conforme `quickstart.md > US3` deve passar.

---

## Phase 6: User Story 4 — Impacto em relatórios e dashboard (Priority: P2)

**Goal**: relatório por plano deduz "Imposto do convênio" do bruto; dashboard financeiro mostra card "Impostos" consolidado (convênio + clínica); resultado operacional usa fórmula completa.

**Independent Test**: ver `spec.md > US4 Independent Test` — Bruto R$ 10k + bps 650 → linha "Imposto do convênio -R$ 650,00"; card "Impostos" agrega.

### Tests for User Story 4 ⚠️

- [ ] T058 [P] [US4] `tests/integration/reports-with-taxes.test.ts` — cria plano com `tax_rate_bps=650`, 1 atendimento R$ 100 (10000 cents); chama `buildFinancialReport`; espera `revenueByPlan[0].taxFromPlanCents===650` e `taxTotals.fromPlansCents===650`
- [ ] T059 [P] [US4] `tests/integration/reports-zero-rate-plan.test.ts` — plano com `tax_rate_bps=0` ⇒ `taxFromPlanCents===0` e `operatingProfitCents` igual ao baseline pré-feature
- [ ] T060 [P] [US4] `tests/integration/reports-multi-plan-rounding.test.ts` — 3 planos com bps distintos sobre `grossRevenueCents=33333` cada; verificar `Math.abs(sum(taxFromPlanCents) - taxTotals.fromPlansCents) <= 1` (tolerância de 1 cent de arredondamento agregado)
- [ ] T061 [P] [US4] `tests/integration/financial-report-tax-card.test.ts` — `taxTotals.totalCents === taxTotals.fromPlansCents + taxTotals.fromExpensesCents` para qualquer cenário
- [ ] T062 [P] [US4] `tests/integration/by-plan-detail-tax.test.ts` — `PlanDetail.totals.netOfPlanTaxCents === PlanDetail.totals.totalRevenueCents - PlanDetail.totals.taxFromPlanCents`

### Implementation for User Story 4

- [ ] T063 [P] [US4] Criar helper compartilhado `src/lib/core/reports/apply-plan-tax.ts` com `applyPlanTax(rows: RevenueByPlanRow[], planTaxMap: Map<string, number>): { rows: (RevenueByPlanRow & { taxRateBps; taxFromPlanCents; netOfPlanTaxCents })[]; totalTaxCents: number }`. Math.round explícito (half-away-from-zero). Função pura
- [ ] T064 [US4] Estender `src/lib/core/reports/financial-report.ts`: (a) tipos `RevenueByPlanRow` ganham `taxRateBps`, `taxFromPlanCents`, `netOfPlanTaxCents`; (b) tipo novo `TaxTotals = { fromPlansCents, fromExpensesCents, totalCents }`; (c) `FinancialReport` ganha `taxTotals: TaxTotals`; (d) `PreviousPeriodTotals` ganha `taxFromPlansCents`; (e) dentro de `buildFinancialReport`, após calcular `revenueByPlan`, carregar `health_plans.tax_rate_bps` para os planIds presentes; chamar `applyPlanTax`; agregar `taxFromExpensesCents` da linha `expensesByCategory.find(c=>c.category==='impostos')`; ajustar `operatingProfitCents = netRevenueCents - totalExpensesCents - taxFromPlansCents`
- [ ] T065 [US4] Estender `src/lib/core/reports/by-plan.ts`: `PlanSummaryRow` e `PlanDetail.totals` ganham `taxRateBps`, `taxFromPlanCents`, `netOfPlanTaxCents`; `summaryByPlan` e `detailByPlan` carregam `health_plans.tax_rate_bps` e aplicam `applyPlanTax`
- [ ] T066 [P] [US4] Atualizar `src/lib/core/reports/export-financial-excel.ts` para incluir aba "Impostos" (linhas: ISO de cada plano com taxFromPlanCents; despesas categoria impostos; totalConvenios; totalClinica; total) + coluna "Imposto do convênio" inserida entre Bruto e Líquido no resumo por plano
- [ ] T067 [P] [US4] Atualizar `src/lib/core/reports/export-by-plan-excel.ts` para incluir as 3 colunas novas (`taxRateBps`, `taxFromPlanCents`, `netOfPlanTaxCents`) no resumo e detalhe
- [ ] T068 [P] [US4] Criar componente `src/app/(dashboard)/analise/relatorios/tax-card.tsx` (Server Component) que recebe `taxTotals: TaxTotals` e renderiza card "Impostos" no padrão visual do `StatCard` existente, com expansível mostrando `fromPlansCents` (do convênio) e `fromExpensesCents` (da clínica)
- [ ] T069 [US4] Estender `src/app/(dashboard)/analise/relatorios/page.tsx` (ou subcomponentes `RevenueSection`/`OperationalResultSection`/`ExpensesSection`) para renderizar `TaxCard` na área de KPIs e adicionar coluna "Imposto do convênio" na tabela de receita por plano (entre Bruto e Líquido). Para `taxRateBps===0`: exibir `R$ 0,00` em cinza claro (não omitir, conforme decisão em research §11)
- [ ] T070 [US4] Rodar `pnpm typecheck`, `pnpm test tests/integration/reports-*.test.ts tests/integration/financial-report-tax-card.test.ts tests/integration/by-plan-detail-tax.test.ts`. Conferir que testes preexistentes do relatório não regridem

**Checkpoint**: US4 fully functional. Manual smoke conforme `quickstart.md > US4` deve passar. Feature inteira está navegável end-to-end.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T071 [P] Rodar `pnpm test` (suite completa) e `pnpm typecheck` + `pnpm lint:auth`. Todos verdes
- [ ] T072 [P] Rodar `pnpm dev` e executar o smoke manual do `quickstart.md` ponta-a-ponta (US1→US2→US3→US4), incluindo verificação de `audit_log` via psql. Marcar todos os critérios "pronto" do quickstart
- [ ] T073 [P] Revisar copy/UX de mensagens de erro: "Já existe um imposto com este nome", "Imposto não encontrado ou inativo", "Alíquota inválida (0 a 100%)" — coerentes com o resto do produto em pt-BR
- [ ] T074 [P] Confirmar que os filtros existentes da página de despesas (`?category=impostos`) continuam funcionando após `tax_id` ser adicionado ao DTO (regressão)
- [ ] T075 Adicionar entry no top do `supabase/migrations/0076_taxes_and_plan_tax_rate.sql` com comentário-cabeçalho explicando os 3 deltas (nova tabela, ALTER em health_plans, ALTER em expenses) + referência à feature spec 011 — padrão visível nas migrations 0028, 0048
- [ ] T076 (Opcional) Atualizar/revalidar `CLAUDE.md`: a seção "Active Technologies" já recebeu entradas para 011 via `update-agent-context.ps1`; conferir que não há linhas duplicadas
- [ ] T077 Confirmar que branch `011-cadastro-impostos` está pronta para PR: lista de arquivos modificados/criados bate com `plan.md > Project Structure`; sem arquivos órfãos; sem `console.log` esquecido nos componentes client
- [ ] T078 Marcar `specs/011-cadastro-impostos/checklists/requirements.md` como totalmente verde (já está; reconfirmar) e adicionar nota final "Implementação concluída em <data>"

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: sem dependências
- **Phase 2 (Foundational)**: depende de Phase 1 — **bloqueia US1, US2, US3, US4**
- **Phase 3 (US1)**: depende de Phase 2 completa
- **Phase 4 (US2)**: depende de Phase 2 completa — **independente de US1**
- **Phase 5 (US3)**: depende de Phase 2 completa + tem **dependência funcional fraca de US1** (precisa de pelo menos 1 imposto ativo para testar o select). Implementação pode rodar em paralelo a US1 desde que os testes integration sejam executados após T024
- **Phase 6 (US4)**: depende de Phase 2 + **dependência funcional de US2** (precisa de `tax_rate_bps` para calcular linha "Imposto do convênio"). Se US3 estiver pronta, US4 fica mais rica (card "Impostos da clínica" agrega expense vinculada); sem US3, US4 ainda funciona usando `expensesByCategory.impostos` (legacy)
- **Phase 7 (Polish)**: depende de US1+US2+US3+US4 completas

### Within Each User Story

- **Testes primeiro** (devem falhar) → modelos/lib core → routes API → componentes UI → integração final
- T015–T020 antes de T021–T030 (US1)
- T032–T036 antes de T037–T043 (US2)
- T045–T051 antes de T052–T056 (US3)
- T058–T062 antes de T063–T069 (US4)

### Parallel Opportunities

**Dentro de Phase 2 (Foundational)**: T012 e T013 (`rate-bps` helper + tests) são paralelizáveis. T003–T010 são sequenciais (escrevem o mesmo arquivo de migration na ordem lógica). T011, T012, T013, T014 podem rodar em paralelo após a migration ser aplicada.

**Entre user stories**: após Phase 2 completar, US1 + US2 (ambas P1) podem ser desenvolvidas por desenvolvedores distintos em paralelo. US3 e US4 podem entrar em sequência depois.

**Dentro de cada US**: todos os testes [P] de uma mesma US podem ser escritos em paralelo (diferentes arquivos). Componentes UI [P] da mesma US (form, row-actions, edit-form) também podem ser feitos em paralelo.

---

## Parallel Example: User Story 1

```bash
# Após Phase 2 completa, lançar tests da US1 em paralelo:
Task: "T015 [US1] tests/contract/taxes-immutability.test.ts"
Task: "T016 [US1] tests/contract/api-impostos-rbac.test.ts"
Task: "T017 [US1] tests/contract/api-impostos-tenant-isolation.test.ts"
Task: "T018 [US1] tests/contract/api-impostos-validation.test.ts"
Task: "T019 [US1] tests/contract/api-impostos-duplicate.test.ts"
Task: "T020 [US1] tests/integration/taxes-crud.test.ts"

# Depois, lançar os 3 módulos core em paralelo:
Task: "T021 [US1] src/lib/core/taxes/create.ts"
Task: "T022 [US1] src/lib/core/taxes/list.ts"
Task: "T023 [US1] src/lib/core/taxes/update.ts"

# Depois (T024+T025 sequenciais nos handlers), UI em paralelo:
Task: "T026 [US1] src/app/(dashboard)/analise/despesas/impostos/page.tsx"
Task: "T027 [US1] src/app/.../impostos/new-tax-form.tsx"
Task: "T028 [US1] src/app/.../impostos/tax-row-actions.tsx"
Task: "T029 [US1] src/app/.../impostos/edit-tax-form.tsx"
```

---

## Implementation Strategy

### MVP First (US1 + US2 — ambas P1)

1. Completar Phase 1 (Setup) → Phase 2 (Foundational, blockers).
2. Implementar **US1** (cadastro de impostos da clínica) → smoke + testes → deploy/demo.
3. Implementar **US2** (alíquota do convênio) → smoke + testes → deploy/demo.
4. **PARE e VALIDE**: clínica já consegue (a) cadastrar impostos, (b) configurar alíquota retida por convênio. Sem US3/US4 ainda, mas o cadastro está completo.

### Incremental Delivery

- **Sprint 1 (MVP)**: Phase 1 + Phase 2 + US1 + US2. Entrega: cadastro completo, sem impacto em relatórios.
- **Sprint 2 (Operacional)**: US3. Entrega: despesas podem ser categorizadas como impostos via vínculo.
- **Sprint 3 (Analítico)**: US4. Entrega: relatório por plano e dashboard com card "Impostos".
- **Sprint 4 (Polish)**: Phase 7. Entrega: cleanup, regressão verificada, PR aberto para review.

### Parallel Team Strategy

Com 2 devs:
1. Ambos completam Setup + Foundational.
2. Após T014: Dev A faz US1 (T015–T031); Dev B faz US2 (T032–T044). Sem conflito de arquivos.
3. Quando US1 e US2 mergeam: Dev A faz US3 (depende minimamente de US1); Dev B faz US4 (depende de US2 + opcionalmente US3).
4. Polish em conjunto.

---

## Notes

- [P] = arquivos distintos e sem dependência de tarefa incompleta.
- [Story] = ancoragem da tarefa em uma das 4 user stories (US1–US4) — útil para split entre devs e PR-por-fatia.
- **Migration 0076 é o ponto de entrada de toda a feature**: nada compila sem ela porque `pnpm supabase:gen-types` gera os tipos `taxes`, `tax_rate_bps`, `tax_id`. Faça T003–T011 antes de qualquer commit que importe esses símbolos.
- **Constitution gates verificados**: ver `plan.md > Constitution Check`. Toda task abaixo se encaixa em padrão preexistente (RLS + append-only + audit + `requireRole`).
- **Audit**: triggers no banco são a fonte de verdade — se um teste de audit falhar, o problema está no banco, não em código TS.
- Evitar `console.log` em componentes client; usar `Pino` no server side via padrão de erros.
- Commit por task (ou bloco lógico de tasks da mesma US) para PR review granular.

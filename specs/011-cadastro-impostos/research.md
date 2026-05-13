# Phase 0 — Research & Decisions: Cadastro de Impostos e Imposto por Convênio

**Status**: completo. Nenhum `[NEEDS CLARIFICATION]` permaneceu do `/speckit-specify`; o user input do `/speckit-plan` ratificou as três decisões estruturais (tabela nova `taxes`, coluna simples em `health_plans`, basis points). Este documento congela as decisões de design e as alternativas avaliadas.

---

## Decisão 1 — Estrutura de dados para impostos da clínica

**Decisão**: criar tabela nova `public.taxes` (e não reutilizar `expenses`).

**Rationale**:
- `expenses` é fato financeiro append-only com triggers de imutabilidade rígidos (cf. `0028_expenses.sql`); um imposto cadastrado é entidade de **referência** (configuração que pode ser editada — alíquota, ativação). Misturar os dois rompe a semântica de cada um.
- A spec descreve impostos como entidades **independentes** que aparecem em `Despesas → Impostos`, com fluxo CRUD (editar, desativar, reativar) distinto do fluxo de lançamento de despesa.
- Despesas podem **referenciar** um imposto (US3), mas o registro de "ISS 5%" continua existindo mesmo sem despesas vinculadas.

**Alternativas consideradas**:
- _"Expense kind = catalog"_ (linha em `expenses` com flag de catálogo): rejeitada — viola a invariante de append-only de despesas e exige soft-delete em entidade financeira.
- _Enum hardcoded no código_ (`ISS`, `IRPJ`, …): rejeitada — impede customização por clínica e bloqueia evolução sem deploy.
- _Tabela compartilhada `chart_of_accounts`_ (plano de contas genérico): rejeitada — overengineer para a entrega atual (US1+US3); pode ser extraída no futuro se outros tipos de despesa de catálogo forem demandados.

---

## Decisão 2 — Nomenclatura da tabela: `taxes` vs `clinic_taxes`

**Decisão**: `public.taxes`.

**Rationale**: o user input explícito do `/speckit-plan` definiu "Impostos da clínica em tabela `taxes` nova". O escopo de cada linha é por `tenant_id` (multi-tenant já é dado pela coluna obrigatória), então o prefixo "clinic_" seria redundante. Convenção de tabelas no projeto: nome no plural curto (`patients`, `appointments`, `procedures`, `expenses`, `health_plans`) — `taxes` se encaixa.

**Alternativas consideradas**:
- `clinic_taxes`: rejeitada — "clinic" é implícito (todo `tenant` é uma clínica).
- `tax_kinds` / `tax_catalog`: rejeitada — sugere catálogo externo padronizado (como TUSS); aqui é configuração do tenant.

---

## Decisão 3 — Unidade da alíquota: basis points (int) vs decimal

**Decisão**: `rate_bps INT NOT NULL` (100 bps = 1,00 %). Faixa válida: `0 ≤ rate_bps ≤ 10000`.

**Rationale**:
- Princípio de domínio da Constitution: "valores monetários em centavos, nunca float". Estender a inteiros para alíquotas elimina a classe inteira de bugs de arredondamento de ponto flutuante.
- `revenue_cents × rate_bps / 10000` em aritmética inteira garante centavos exatos (com truncamento explícito documentado).
- User input do `/speckit-plan` confirmou bps.

**Alternativas consideradas**:
- `numeric(5,4)` (decimal exato em SQL): viável e seria preciso, mas força mais cuidado em joins/agregações TS (libs JS de decimal não estão no projeto). Bps + inteiro é mais simples e suficiente para 4 dígitos significativos (uma casa após o decimal por cento = 0.01% = 1 bp).
- `float8`: rejeitada — proibido por constituição para qualquer cálculo financeiro.

**Política de arredondamento**: entrada na UI aceita até 2 casas decimais (`6,50` → 650 bps). Mais casas (`6,505` → 651 bps) usam **half-up** explícito no helper `rate-bps.ts`. Cálculo de imposto em centavos: `Math.round(revenueCents * rateBps / 10000)` (banker's rounding não é usado; ver Decisão 9).

---

## Decisão 4 — Onde mora a alíquota do convênio

**Decisão**: coluna `health_plans.tax_rate_bps INT NOT NULL DEFAULT 0`. **Sem** tabela `health_plan_taxes`. **Sem** FK para `taxes`.

**Rationale**:
- A spec é explícita: "É apenas um campo percentual no convênio". Modelar como tabela auxiliar adicionaria N+1 leitura nos relatórios sem ganho.
- Semanticamente, a alíquota retida pelo convênio é diferente da carga tributária da clínica (US1) — não faz sentido normalizar para a mesma entidade.
- Limita-se a uma alíquota por convênio (regra de negócio simples). Caso vire necessário composição de alíquotas, a refatoração futura é mecânica.

**Alternativas consideradas**:
- `health_plan_taxes (plan_id, tax_id, rate_bps)` — rejeitada pelo input do usuário; também viola o requisito FR-012.
- JSON `health_plans.config->'tax_rate_bps'` — rejeitada porque o campo é índice-friendly e analítico (usado em todo relatório por plano) — coluna típica vence.

---

## Decisão 5 — Vínculo despesa→imposto: tabela auxiliar vs FK direto

**Decisão**: coluna nova `expenses.tax_id UUID NULL REFERENCES public.taxes(id) ON DELETE RESTRICT`, com CHECK que força `tax_id IS NULL OR category = 'impostos'`.

**Rationale**:
- 1:1 (uma despesa referencia, no máximo, um imposto cadastrado). Tabela auxiliar seria N:1 ou M:N e não há demanda para isso.
- CHECK no banco garante a invariante FR-015 ("categoria forçada para 'impostos' quando há vínculo") mesmo se a UI esquecer.
- `ON DELETE RESTRICT` é coerente com o resto do schema (`tenant_id`, `created_by` usam o mesmo).

**Alternativas consideradas**:
- Tabela `expense_taxes(expense_id, tax_id)`: rejeitada — assume futuro multi-vínculo que a spec nega.
- Apenas atribuir `category='impostos'` sem FK: rejeitada — perde rastreabilidade ("este pagamento foi do ISS ou do IRPJ?") e relatórios não conseguem agrupar.

---

## Decisão 6 — Append-only para `taxes`: nível de imutabilidade

**Decisão**: trigger `enforce_taxes_mutation` permite mutação apenas de `rate_bps`, `description`, `is_active`, `deleted_at`. Imutáveis: `id`, `tenant_id`, `name`, `category`, `created_at`, `created_by`.

**Rationale**:
- `name` define a identidade do imposto. Renome silencioso quebraria audit history ("ISS virou IRPJ?").
- `category` (Municipal/Estadual/Federal/Outro) é classificação estrutural — mudança equivale a criar imposto novo.
- `rate_bps` é mutável porque a spec descreve "editar alíquota" no fluxo da listagem (US1 Acceptance Scenario 1 implica capacidade de ajuste); cada alteração gera audit (FR-022) usando o old_value/new_value.
- `is_active` é mutável (desativar / reativar = soft-delete reversível). DELETE físico bloqueado por `enforce_append_only`.

**Alternativas consideradas**:
- Imutar `rate_bps` (criar versão nova como em `price_versions`): rejeitada — overkill para impostos da clínica; alíquota não tem semântica temporal por atendimento (a despesa de imposto é gravada em valor absoluto).
- Permitir mutação de `name`: rejeitada (audit fica inconsistente).

---

## Decisão 7 — Auditoria: triggers no banco vs aplicação

**Decisão**: triggers no banco (`audit_taxes_change` AFTER INSERT/UPDATE em `taxes`, `audit_health_plan_tax_rate_change` AFTER UPDATE OF `tax_rate_bps` em `health_plans`) chamando `log_audit_event`.

**Rationale**:
- Padrão já vigente: `audit_payment_records_change`, `audit_payment_installments_change` etc.
- Trigger no banco garante invariante "toda mudança auditada" independentemente do caminho de escrita (rota HTTP, script de manutenção, console SQL). Cumpre Principle II literalmente.
- O contexto do ator vem via `current_setting('app.actor_id')` que as rotas HTTP já injetam (`session_uuid`).

**Alternativas consideradas**:
- Audit na camada de serviço TS: rejeitada — falha silenciosa se rota nova esquecer; viola "trilha sobrevive a delete lógico".
- Audit via Supabase Edge Functions: rejeitada — atalho que reduz testabilidade local e atrasa o evento.

---

## Decisão 8 — RBAC: granularidade nova vs reuso

**Decisão**: adicionar actions `tax.write` (admin, financeiro) e `tax.read` (admin, financeiro, recepcionista, profissional_saude) ao `MATRIX` em `src/lib/auth/rbac.ts`. Não reusar `expense.write` para taxa-write porque a semântica é distinta.

**Rationale**:
- Recepcionista hoje vê impostos para informar paciente (princípio de transparência) mas não pode editá-los.
- Profissional de saúde também pode ler (uso de dashboards informativos), mas não escrever.
- Permite revogar acesso de escrita de impostos sem revogar acesso a despesas, futuro-prova.

**Alternativas consideradas**:
- Reutilizar `expense.write`: rejeitada — impostos não são despesas, gerencia diferente (cadastro de catálogo vs lançamento de fato).
- Adicionar nova role `tributario`: rejeitada — fora do escopo da feature; a Constitution V já define os 4 papéis suportados.

---

## Decisão 9 — Arredondamento do imposto do convênio em relatórios

**Decisão**: `taxFromPlanCents = Math.round(grossRevenueCents * tax_rate_bps / 10000)`, calculado **server-side** dentro de `buildFinancialReport` e `buildByPlan`, agregado por plano antes de somar para o total.

**Rationale**:
- Server-side garante paridade entre JSON, PDF e Excel (mesmo princípio que `MonthlyReport` já segue).
- `Math.round` (half-away-from-zero) é o que o JS faz por padrão e é o praticado no resto do projeto (`financial-report.ts:164`).
- Tolerância documentada: SC-003 admite divergência de até 1 centavo por arredondamento entre planos quando a soma do detalhamento e o total agregado são comparados.
- Cálculo por plano (não no nível de linha de procedimento) é suficiente — diferença é centavos no agregado, e simplifica a UI.

**Alternativas consideradas**:
- Calcular por linha de `appointment_procedures`: maior precisão, mas custo de leitura e complexidade no DTO; ROI ruim.
- Arredondamento banker's: rejeitada — incoerente com restante do código.

---

## Decisão 10 — Versionamento histórico de alíquotas

**Decisão**: **sem versionamento**. `tax_rate_bps` no `health_plans` e `rate_bps` em `taxes` são "estado atual"; alterações geram audit mas não mantêm histórico vigente.

**Rationale**:
- Spec deixa explícito como _intentional limitation_ (FR-021, Assumptions). A motivação é manter o modelo simples; ninguém pediu replay de cenários históricos com alíquotas distintas.
- Audit_log preserva o histórico de mudança caso necessário para investigação retroativa.
- Se demanda surgir, refatoração futura cria `health_plan_tax_versions(plan_id, rate_bps, valid_from)` sem quebrar nenhum dado existente.

**Alternativas consideradas**:
- Espelhar o padrão de `price_versions` (uma row por mudança): rejeitada — overkill agora.

---

## Decisão 11 — Localização da rota Impostos no dashboard

**Decisão**: `/(dashboard)/analise/despesas/impostos`.

**Rationale**:
- A rota de despesas hoje vive em `/(dashboard)/analise/despesas/page.tsx`. Não existe (e não vai existir) uma `/(dashboard)/despesas` paralela.
- Manter sub-páginas como sub-rotas do mesmo recurso é o padrão usado em `configuracoes/convenios/[id]/...`.
- A spec menciona "Na seção de despesas, sub-seção 'Impostos'" — `analise/despesas/impostos` honra isso semanticamente.

**Alternativas consideradas**:
- `/(dashboard)/configuracoes/impostos`: rejeitada — desviado do mental model do user (impostos vivem perto de despesas).
- Apenas como dialog na página de despesas: rejeitada — não comporta listagem + form, e UX fica apertada em 50 % de viewport.

---

## Decisão 12 — Migration numbering & rollback

**Decisão**: `0076_taxes_and_plan_tax_rate.sql`. Próximo número após `0075_custom_procedure_tables.sql` (último merged em master). Migration **não** é destrutiva: adiciona tabela e duas colunas com DEFAULT seguro (zero/null).

**Rollback documentado** no quickstart: `DROP TABLE taxes CASCADE; ALTER TABLE health_plans DROP COLUMN tax_rate_bps; ALTER TABLE expenses DROP COLUMN tax_id;` — viável em dev (constituição §"Migrações de banco" exige reversibilidade em dev).

---

## Decisão 13 — Testes obrigatórios por constituição

A Constitution §"Fluxo de Desenvolvimento" impõe:
- **(a) imutabilidade**: `tests/contract/taxes-immutability.test.ts` tenta `UPDATE taxes SET name='X'` e espera `RAISE EXCEPTION`.
- **(b) isolamento entre tenants**: `tests/contract/api-impostos-tenant-isolation.test.ts` autentica como tenant A e tenta ler/escrever em tenant B; espera 404/0 rows.
- **(c) RBAC por papel**: `tests/contract/api-impostos-rbac.test.ts` × 4 papéis × 3 endpoints (GET, POST, PATCH); cada combinação esperada documentada.

Status: documentado; geração dos arquivos é tarefa de `/speckit-tasks`.

---

## Decisão 14 — Auditoria de `expenses.tax_id`

**Decisão**: o evento de criação de despesa já é auditado (linha em audit_log com `entity='expenses'`); incluímos `tax_id` no payload audit via campo `field='tax_id', new_value=tax_id_uuid`. Como `expenses.tax_id` é **imutável** (já bloqueado pelo trigger `enforce_expenses_mutation` se for adicionado à lista), não há evento de UPDATE para auditar.

**Implementação**: ALTER do trigger `enforce_expenses_mutation` para adicionar `tax_id` à lista de colunas imutáveis. O trigger existente já dispara `RAISE EXCEPTION` em mudança das demais colunas críticas — incluímos `tax_id` na mesma cláusula.

---

## Sumário das alternativas avaliadas e rejeitadas

| # | Tema | Rejeitado | Por quê |
|---|---|---|---|
| 1 | Estrutura | Reusar `expenses` para impostos | Mistura entidade de fato com catálogo |
| 2 | Nome | `clinic_taxes` | Redundante (toda tabela é por tenant) |
| 3 | Unit | `float8` para alíquota | Proibido por constituição |
| 4 | Modelagem convênio | Tabela `health_plan_taxes` | Viola FR-012 e user input |
| 5 | Modelagem despesa | Tabela `expense_taxes` | Cardinalidade exagerada para a spec |
| 6 | Imutabilidade | `name` mutável | Quebra audit history |
| 7 | Audit | Em camada de serviço TS | Possibilidade de bypass; viola Principle II |
| 8 | RBAC | Reusar `expense.write` para tax | Semântica distinta; futuro-prova ruim |
| 9 | Arredondamento | Banker's rounding | Incoerente com resto do projeto |
| 10 | Versionamento | Tabela de versões de alíquota | Overengineering; sem demanda |
| 11 | Rota UI | `/configuracoes/impostos` | Desalinha do mental model do user |

---

## Tudo resolvido — pronto para Phase 1

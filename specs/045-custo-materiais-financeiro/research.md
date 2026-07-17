# Phase 0 — Research & Decisions

Feature: Custo de materiais e métrica "Gasto com materiais" (045)

Todas as `NEEDS CLARIFICATION` foram resolvidas na fase `/speckit.clarify` (ver `spec.md` › Clarifications). Abaixo, as decisões técnicas que orientam o design.

## D-01 — Catálogo de insumo próprio (`tenant_materials`), não reuso de TUSS

- **Decisão**: criar tabela nova `tenant_materials` (por tenant) com custo unitário editável e `tuss_code` **opcional**.
- **Rationale**: TUSS tabela 19 é catálogo global de leitura, sem preço, e cobre só materiais de convênio/OPME — não os insumos do dia a dia (resina, anestésico, luva). O custo é interno da clínica, não um preço faturado. Confirma Decisão D2.
- **Alternativas**: (a) adicionar custo em `tuss_codes` — rejeitada: catálogo global imutável (Princípio IV) e não cobre insumos não-TUSS; (b) modelar tudo como `expenses` — rejeitada: perde a atribuição por atendimento/procedimento e a margem real.

## D-02 — Custo congelado (snapshot) em `appointment_materials`

- **Decisão**: acrescentar `unit_cost_cents` (snapshot no INSERT) e `material_id` (proveniência opcional) em `appointment_materials`. O custo total é derivado (`unit_cost_cents * quantity`).
- **Rationale**: segue o padrão de "congelar" do projeto (`tuss_description`, `frozen_amount_cents`) e satisfaz o Princípio I — o registro financeiro de referência é imutável, mesmo que o catálogo mude depois.
- **Alternativas**: join ao catálogo em tempo de consulta — rejeitada: o custo mudaria retroativamente ao editar o catálogo (viola FR-006 e Princípio I).

## D-03 — Desconto só na margem da clínica (Decisão D1)

- **Decisão**: o "Gasto com materiais" é uma **linha de dedução nova** no `operating-result`, subtraída depois das despesas. **Não** altera `net_commission_cents`, comissões nem `monthly_payouts`.
- **Rationale**: mantém o repasse e os fechamentos mensais (append-only, mês-fechado) intocados — menor risco e coerente com o clarify.
- **Alternativas**: descontar da base de repasse — rejeitada: mexeria em `commissions`/`monthly_payouts` e reabriria fechamentos (alto risco, fora de escopo).

## D-04 — Base temporal = `appointment_at`, exclui estornados

- **Decisão**: o gasto do período soma o custo dos materiais dos atendimentos cujo `appointment_at` cai no período e que **não** têm linha em `appointment_reversals`.
- **Rationale**: alinha exatamente com como `operating-result` já computa receita/comissões (via `appointments_effective` por `appointment_at`, excluindo `estornado`). Consistência de fronteira de mês (fuso do tenant) e de exclusão de estorno.
- **Alternativas**: por `created_at` do material — rejeitada: desalinha do restante do resultado do mês.

## D-05 — Pendência de custo derivada de `unit_cost_cents = 0`

- **Decisão**: material com `unit_cost_cents = 0` é tratado como **pendência de custo** (sinalizado na UI), sem coluna de status extra.
- **Rationale**: simples e suficiente; insumo legitimamente sem custo e "a completar" convergem para o mesmo tratamento (não infla o gasto, aparece como pendência).
- **Alternativas**: coluna `cost_status` enum — rejeitada: complexidade desnecessária para o MVP; pode ser adicionada depois se preciso distinguir "grátis" de "pendente".

## D-06 — Completar/corrigir custo pendente via column-guard relaxado

- **Decisão**: relaxar o trigger append-only de `appointment_materials` para permitir UPDATE **apenas** de `unit_cost_cents` (e `material_id`), via RPC `set_appointment_material_cost` `SECURITY DEFINER` auditada (admin/financeiro).
- **Rationale**: precedente no projeto (`treatment_plan_steps.appointment_id`, feature 005). Preserva a imutabilidade do uso (material/quantidade), audita a mudança de custo (Princípio II).
- **Alternativas**: tabela append-only de correções — rejeitada (ver Complexity Tracking do plano).

## D-07 — Agregador único reutilizado (`reports/materials-cost.ts`)

- **Decisão**: uma função de agregação (`sumMaterialsCost({tenantId, from, to, groupBy?})`) alimenta o resultado operacional e todos os relatórios/exports.
- **Rationale**: evita duplicar a regra de exclusão de estorno e de fronteira de mês em 5+ lugares; um ponto único de teste.

## D-08 — RBAC (item adiado no clarify)

- **Decisão**: gerência do catálogo e override/correção de custo restritos a `admin` e `financeiro`; anexar material com custo-padrão automático segue os papéis que já anexam material hoje (recepção/profissional). Autorização server-side via `requireRole`.
- **Rationale**: definir custo é ato financeiro (Princípio V); recepção não deve editar custo, mas o custo-padrão do catálogo é aplicado automaticamente sem exigir permissão financeira.
- **Alternativas**: liberar override para todos — rejeitada por RBAC.

## Convenções confirmadas

- Migration nova: **`0172_material_costs.sql`** (última é `0171`).
- Valores em centavos; timestamps UTC; sem novas dependências de runtime.
- `lint:auth` e testes de contrato (imutabilidade, isolamento de tenant, RBAC) obrigatórios (constituição § Quality Gates).

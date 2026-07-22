# Implementation Plan: Plano Alimentar

**Branch**: `047-plano-alimentar` | **Date**: 2026-07-21 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/047-plano-alimentar/spec.md`

## Summary

Construtor de **plano alimentar** (gated por `hasModule('dieta')`): uma **base de alimentos** com nutrientes (catálogo global somente-leitura + alimentos próprios por clínica) alimenta a montagem de um **cardápio por refeições**, com **soma automática ao vivo** de energia e macros por refeição e por dia, **comparação com a meta** (VET/macros) vinda da Avaliação Nutricional (046), e **listas de substituição** por grupo alimentar (o "OU" das planilhas). Ao **prescrever**, o plano vira um **retrato imutável** entregue ao paciente no portal.

Abordagem técnica em três camadas:

1. **Motor de cálculo TS puro** (`src/lib/core/nutrition/diet/totals.ts`) — isomórfico, como o motor da 046: roda no cliente para o total ao vivo e no servidor para congelar a prescrição. Mesma fonte, zero divergência entre o que a tela mostra e o que é gravado.
2. **Catálogo de alimentos** seguindo o padrão já validado da migration 0123 (`patient_metric_types`): `tenant_id NULL` = global somente-leitura, `tenant_id` setado = custom da clínica, RLS com `tenant_id IS NULL OR tenant_id = jwt_tenant_id()`.
3. **Extensão das tabelas `diet_*` existentes** (migration 0122, já em produção) em vez de recriar — `diet_meal_items` ganha vínculo com alimento, quantidade em gramas e **snapshot nutricional congelado**; o `food TEXT` legado permanece para os itens de texto livre já gravados.

**Sem novas dependências.**

## Technical Context

**Language/Version**: TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel)
**Primary Dependencies**: Next.js 14.2 (App Router, RSC, Server Actions, Route Handlers), `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind 3.4, shadcn/ui (Radix), `lucide-react`. **Sem novas deps** — o cálculo é aritmética simples (regra de três sobre a porção de referência).
**Storage**: PostgreSQL via Supabase (local: `supabase start` :54321) com RLS por `tenant_id`. **Migration nova**: `0176_food_catalog_and_diet_plan.sql`. **Tabelas novas**: `food_groups`, `foods`, `food_household_measures`, `food_equivalence_lists`, `food_equivalence_items`, `diet_plan_prescriptions`. **Tabelas estendidas**: `diet_plans`, `diet_meal_items`. **Reuso (leitura)**: `nutrition_assessments` (meta VET/macros da 046), `patients`, `tenant_entitlements`.
**Testing**: vitest — `pnpm test`, `pnpm test:integration`, `pnpm test:contract`
**Target Platform**: web (dashboard da clínica + portal do paciente)
**Project Type**: web application (Next.js full-stack, monorepo único)
**Performance Goals**: busca de alimento com resposta perceptivelmente imediata (typeahead sobre catálogo de milhares de itens); total do cardápio recalculado ao vivo sem round-trip ao servidor.
**Constraints**: o catálogo global entra no ciclo de `test_truncate_all_mutable` (migration 0170) — ver Decisão D3 em research.md, é o principal risco técnico da feature. Nutrientes em `NUMERIC`, nunca `float`.
**Scale/Scope**: catálogo global na ordem de milhares de alimentos; 4 histórias de usuário; ~1 tela nova no dashboard + extensão do card do portal.

## Constitution Check

*GATE: avaliado antes da Phase 0 e reavaliado após a Phase 1.*

| Princípio | Aplicabilidade | Como a feature atende |
|---|---|---|
| **I. Integridade Imutável** (NON-NEGOTIABLE) | **Aplica por analogia.** Não é valor financeiro, mas é **prescrição clínica** — o que foi prescrito a um paciente não pode ser reescrito. | `diet_plan_prescriptions` é **append-only** (trigger anti-UPDATE/DELETE, `REVOKE` de `authenticated`), guardando snapshot JSONB completo. Correção = nova prescrição, nunca edição. Os valores nutricionais são **congelados** em `diet_meal_items` na prescrição (FR-017), de modo que editar a base depois não altera plano prescrito (SC-004). |
| **II. Auditabilidade** (NON-NEGOTIABLE) | **Aplica.** FR-018. | `log_audit_event` em: prescrição de plano, criação/edição/desativação de alimento próprio. Trigger `AFTER INSERT` no padrão já usado pela 0175. |
| **III. Isolamento Multi-Tenant** | **Aplica.** FR-003, SC-005. | `tenant_id` obrigatório em toda tabela de dados da clínica; catálogo global usa `tenant_id NULL` com RLS `tenant_id IS NULL OR tenant_id = jwt_tenant_id()` (padrão 0123). PKs em UUID. **Teste de contrato de isolamento obrigatório.** |
| **IV. Conformidade TUSS/ANS** | **NÃO SE APLICA.** | A feature não emite cobrança nem usa código de procedimento. Nenhum ponto de contato com TUSS/TISS. |
| **V. RBAC** | **Aplica.** FR-002, FR-001, SC-006. | `requireRole` server-side em toda rota; escrita restrita a `admin` e `profissional_saude`; gate de módulo `hasModule('dieta')` na page (RSC) **e** na rota — controle de UI sozinho é insuficiente. **Teste de autorização por papel obrigatório.** |

**Quality Gates obrigatórios** (Seção 3 da constituição) — esta feature toca acesso multi-tenant, logo exige as três classes de teste:

- (a) **Imutabilidade**: `diet_plan_prescriptions` rejeita UPDATE e DELETE; plano prescrito não muda quando o alimento de origem é editado.
- (b) **Isolamento**: tenant B não lê nem escreve alimento próprio/plano do tenant A; catálogo global é legível por ambos e não editável por nenhum.
- (c) **Autorização**: cada papel (`admin`, `financeiro`, `recepcionista`, `profissional_saude`) testado contra criar/prescrever/cadastrar alimento; sem módulo `dieta` → negado.

**Migrações**: a 0176 é aditiva (novas tabelas + `ADD COLUMN` nullable). **Nenhum drop de coluna ou tabela.** Os dados de `diet_meal_items.food` (texto livre) são preservados — ver Decisão D2.

**Resultado do gate (pré-Phase 0): PASSA.** Nenhuma violação a justificar; a seção Complexity Tracking fica vazia.

### Reavaliação pós-Phase 1

Revisado contra o `data-model.md` e os `contracts/` já escritos:

- **I** — `diet_plan_prescriptions` nasce append-only (trigger `enforce_append_only` + `REVOKE`), e o congelamento em `snap_*` está especificado no data-model. O quickstart tem um passo dedicado a provar isso (alterar a base e verificar que o plano prescrito não muda). ✅
- **II** — auditoria definida para prescrição e para CRUD de alimento próprio, via `log_audit_event` já existente. ✅
- **III** — toda tabela de clínica tem `tenant_id`; catálogo global usa `tenant_id NULL` com a RLS da 0123; contrato de isolamento previsto. ✅
- **IV** — permanece **não aplicável**. ✅
- **V** — `requireRole` + `hasModule('dieta')` em toda rota; contratos declaram 403/404 por papel e por módulo. ✅

**Novo achado da Phase 0 com efeito no gate**: a licença da TACO exige **atribuição da fonte** — obrigação contratual, não estética. A spec não tem requisito cobrindo isso hoje (**Lacuna L1** em `research.md`, com o texto de FR-020 proposto). Não é violação da constituição, mas é requisito legal que precisa entrar na spec antes da implementação, senão vira dívida invisível.

**Resultado do gate (pós-Phase 1): PASSA.** Complexity Tracking segue vazia.

## Project Structure

### Documentation (this feature)

```text
specs/047-plano-alimentar/
├── plan.md              # Este arquivo
├── research.md          # Phase 0 — decisões (base de alimentos, catalog_baseline, versionamento)
├── data-model.md        # Phase 1 — entidades, colunas, RLS, triggers
├── quickstart.md        # Phase 1 — roteiro de validação manual
├── contracts/           # Phase 1 — contratos das rotas
├── checklists/          # já existente
└── tasks.md             # Phase 2 — gerado por /speckit-tasks (NÃO por este comando)
```

### Source Code (repository root)

```text
src/
├── lib/core/nutrition/
│   ├── diet/
│   │   ├── totals.ts            # NOVO — motor puro: item→nutrientes, soma por refeição/dia, delta vs meta
│   │   ├── plan.ts              # NOVO — montar/editar plano (rascunho)
│   │   ├── prescribe.ts         # NOVO — congela snapshot + grava prescrição + auditoria
│   │   └── index.ts             # NOVO — barrel
│   ├── foods/
│   │   ├── search.ts            # NOVO — busca no catálogo (global + custom da clínica)
│   │   ├── custom.ts            # NOVO — CRUD de alimento próprio
│   │   ├── equivalence.ts       # NOVO — grupos e listas de substituição
│   │   └── index.ts             # NOVO — barrel
│   └── (assessments/, energy.ts, body-composition.ts… já existem da 046)
│
├── lib/core/patient-portal/
│   └── diet.ts                  # ESTENDER — passa a ler a prescrição (snapshot), não o rascunho
│
├── app/api/
│   ├── alimentos/route.ts               # NOVO — GET busca, POST alimento próprio
│   ├── alimentos/[id]/route.ts          # NOVO — PATCH/DELETE alimento próprio
│   ├── alimentos/grupos/route.ts        # NOVO — grupos + listas de substituição
│   └── pacientes/[id]/plano-alimentar/
│       ├── route.ts                     # NOVO — GET plano vigente, POST/PATCH rascunho
│       └── prescrever/route.ts          # NOVO — POST prescreve (gera versão imutável)
│
├── app/(dashboard)/operacao/plano-alimentar/
│   ├── page.tsx                 # NOVO — RSC, gate hasModule('dieta')
│   ├── plan-builder-client.tsx  # NOVO — cardápio + totais ao vivo + delta vs meta
│   └── _components/
│       ├── food-typeahead.tsx   # NOVO — busca de alimento
│       ├── meal-editor.tsx      # NOVO — refeição e seus itens
│       └── totals-panel.tsx     # NOVO — totais do dia vs meta
│
├── app/(dashboard)/configuracoes/alimentos/
│   └── page.tsx                 # NOVO — cadastro de alimentos próprios e grupos (card do hub)
│
└── components/patient-portal/
    └── plan-cards.tsx           # ESTENDER — exibir refeições/itens/substituições da prescrição

supabase/migrations/
└── 0176_food_catalog_and_diet_plan.sql   # NOVO

scripts/
└── seed-foods.ts                # NOVO — ingestão do catálogo global (+ variante :prod)

tests/
├── unit/nutrition-diet-totals.spec.ts            # NOVO — motor de soma e delta vs meta
├── contract/diet-prescription-immutability.spec.ts   # NOVO — gate (a)
├── contract/diet-tenant-isolation.spec.ts            # NOVO — gate (b)
├── contract/diet-plan-rbac.spec.ts                   # NOVO — gate (c)
└── integration/diet-plan-*.spec.ts                   # NOVO — por história
```

**Structure Decision**: mantém-se a estrutura única do Next.js já em uso (sem separar backend/frontend). O motor de cálculo vive em `src/lib/core/nutrition/diet/` como **TS puro isomórfico**, espelhando a escolha da 046 (`src/lib/core/nutrition/`) que se provou correta: a mesma função calcula o total exibido ao vivo no cliente e o total congelado no servidor, eliminando a classe de bug em que a tela mostra um número e o banco grava outro. O catálogo de alimentos fica sob `foods/` por ser domínio próprio (consultado também fora do plano alimentar, ex.: futuro recordatório R24h).

## Complexity Tracking

> Preencher apenas se o Constitution Check tiver violações a justificar.

**Vazio** — nenhuma violação. A feature usa exclusivamente padrões já estabelecidos no projeto (catálogo global+custom da 0123, append-only + auditoria da 0175, gate de módulo da 042, motor puro isomórfico da 046).

# Implementation Plan: Custo de materiais e métrica "Gasto com materiais" no financeiro

**Branch**: `045-custo-materiais-financeiro` | **Date**: 2026-07-09 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/045-custo-materiais-financeiro/spec.md`

## Summary

Capturar o custo dos materiais/insumos consumidos em cada atendimento e refleti-lo no financeiro como a métrica **"Gasto com materiais"**. A abordagem reaproveita a estrutura existente: um **catálogo leve de insumos por clínica** (custo unitário editável, com vínculo TUSS opcional) fornece o custo padrão; ao anexar o material ao atendimento o custo é **congelado (snapshot)** numa coluna nova de `appointment_materials` (append-only), com override opcional. Uma função de agregação nova soma o custo dos materiais dos atendimentos ativos do período e é consumida por uma **linha de dedução nova** no resultado operacional e por **colunas novas** nos relatórios por profissional, por convênio, mensal e nos exports. O custo desconta **apenas a margem da clínica** (Decisão D1) — não toca em comissão/repasse nem nos fechamentos mensais.

## Technical Context

**Language/Version**: TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel)
**Primary Dependencies**: Next.js 14.2 (App Router, RSC, Server Actions, Route Handlers), `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind 3.4, shadcn/ui (Radix), `lucide-react`, `@react-pdf/renderer` (PDF), `exceljs` (Excel) — **sem novas deps**
**Storage**: PostgreSQL via Supabase (local: `supabase start` :54321) com RLS por `tenant_id`. **Migration nova**: `0172_material_costs.sql`
**Testing**: Vitest (`pnpm test`, `pnpm test:integration`, `pnpm test:contract`); `pnpm lint:auth`
**Target Platform**: Web (Vercel), navegador desktop/mobile
**Project Type**: Web (monolito Next.js — App Router + camada de domínio em `src/lib/core`)
**Performance Goals**: Consultas de relatório sobre os atendimentos do mês de um tenant (ordem de centenas a poucos milhares de linhas) — agregação simples, sem meta especial de latência além do padrão dos relatórios já existentes
**Constraints**: Valores em centavos (BRL); `appointment_materials` append-only; RLS + `jwt_tenant_id()`; RPCs `SECURITY DEFINER`; auditoria via `log_audit_event`; **não alterar** comissões/repasse/fechamentos; **não quebrar** o fluxo TUSS/TISS existente
**Scale/Scope**: por clínica (multi-tenant); catálogo de dezenas a centenas de insumos; materiais por atendimento tipicamente 0–10

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Impacto | Aderência |
|---|---|---|
| **I. Integridade Financeira Imutável** | O custo incorrido é registro financeiro | ✅ O registro financeiro de referência é o **snapshot congelado** em `appointment_materials` (append-only). O catálogo é config de custo (não é preço faturado). Completar/corrigir um custo pendente usa **UPDATE de coluna única** (`unit_cost_cents`) via RPC auditada, seguindo o precedente de column-guard relaxado do projeto (ver Complexity Tracking) |
| **II. Auditabilidade Total** | Catálogo, correção de custo e uso de material | ✅ `log_audit_event` no INSERT/UPDATE do catálogo, na correção de custo pendente e no uso do material (o uso já é auditado hoje) — com ator, timestamp, tenant, valor anterior/novo |
| **III. Isolamento Multi-Tenant** | Tabela nova + agregações | ✅ `tenant_id` obrigatório na `tenant_materials`; RLS por `jwt_tenant_id()`; RPCs validam tenant; toda agregação filtra por `tenant_id`; PK UUID |
| **IV. Conformidade TUSS/ANS** | Vínculo TUSS opcional | ✅ Custo é dado interno (não é preço de convênio faturado). O `tuss_code` opcional, quando presente, é validado como tabela 19 vigente (reusa a lógica existente). O fluxo TUSS/TISS de convênio permanece intacto |
| **V. Segurança por Perfil (RBAC)** | CRUD de catálogo, override e correção de custo | ✅ Gerência do catálogo + override/correção de custo restritos a `admin`/`financeiro` (server-side `requireRole`); anexar material com custo-padrão automático segue os papéis atuais; negações auditadas |

**Domínio & Compliance**: valores em centavos ✅; timestamps UTC na persistência ✅; sem PII nova (custo/nome de insumo não é dado pessoal) ✅; observabilidade estruturada nos caminhos financeiros ✅.

**Resultado do gate**: PASS (com 1 justificativa em Complexity Tracking).

## Project Structure

### Documentation (this feature)

```text
specs/045-custo-materiais-financeiro/
├── plan.md              # Este arquivo
├── research.md          # Fase 0 — decisões
├── data-model.md        # Fase 1 — schema
├── quickstart.md        # Fase 1 — como validar
├── contracts/           # Fase 1 — RPCs + funções de domínio + rotas
│   ├── db-rpcs.md
│   ├── domain-functions.md
│   └── api-routes.md
└── tasks.md             # Fase 2 — /speckit.tasks (não criado aqui)
```

### Source Code (repository root)

```text
supabase/migrations/
└── 0172_material_costs.sql          # tenant_materials + ALTER appointment_materials
                                      # + RPCs (attach/create atualizadas, set_material_cost)
                                      # + trigger column-guard, RLS, audit

src/lib/core/
├── materials-catalog/               # NOVO — catálogo de insumos por tenant
│   ├── create.ts                    # criar insumo (admin/financeiro)
│   ├── update.ts                    # editar custo/nome/ativo (auditado)
│   ├── list.ts                      # listar ativos p/ seletor + gestão
│   └── index.ts
├── appointments/materials/
│   ├── attach.ts                    # ESTENDER — aceita unit_cost_cents + material_id
│   ├── index.ts                     # ESTENDER — create_appointment_with_materials com custo
│   ├── list.ts                      # ESTENDER — retorna custo + pendência
│   └── set-cost.ts                  # NOVO — completar/corrigir custo pendente (auditado)
└── reports/
    ├── materials-cost.ts            # NOVO — agregação (por mês / profissional / convênio)
    ├── operating-result.ts          # ESTENDER — linha materialsCostCents + drilldown
    ├── by-professional.ts           # ESTENDER — coluna gasto com materiais
    ├── by-plan.ts                   # ESTENDER — coluna gasto com materiais
    ├── monthly.ts / financial-report.ts   # ESTENDER — linha no fechamento
    └── export-*.ts / export-*.tsx   # ESTENDER — coluna nos Excel/PDF

src/app/(dashboard)/
├── configuracoes/materiais/         # NOVO — CRUD do catálogo (admin/financeiro)
│   ├── page.tsx  materiais-table.tsx  material-form.tsx
└── operacao/atendimentos/_components/
    └── add-procedure-section.tsx / materiais picker  # ESTENDER — campo de custo + pendência

src/app/api/
├── materiais/                       # NOVO — Route Handlers do catálogo (requireRole)
└── atendimentos/[id]/materiais/     # ESTENDER — custo no anexo + endpoint de correção

tests/  (vitest)
├── contract/  materials-cost-immutability, tenant-isolation, rbac
├── integration/  attach-with-cost, operating-result-with-materials, reports-materials
└── unit/  materials-cost aggregation, pending-cost derivation
```

**Structure Decision**: Monolito Next.js existente. O catálogo ganha um módulo de domínio próprio (`materials-catalog`) e uma tela em `/configuracoes`; a captura de custo estende o módulo de materiais do atendimento já existente; a métrica ganha um agregador único (`reports/materials-cost.ts`) reutilizado pelo resultado operacional e pelos relatórios, minimizando duplicação.

## Complexity Tracking

| Violação | Por que é necessária | Alternativa mais simples rejeitada porque |
|---|---|---|
| UPDATE de coluna única (`unit_cost_cents`) em `appointment_materials` (append-only) para completar/corrigir custo pendente | O clarify definiu "permite custo 0 e completa depois"; sem isso, um custo pendente nunca poderia ser preenchido | Tabela append-only de correções (`appointment_material_cost_adjustments`) foi considerada e rejeitada: adiciona uma tabela + join de "custo efetivo = última correção" a todas as agregações, peso desproporcional para um caminho raro. O column-guard relaxado (só `unit_cost_cents`, via RPC `SECURITY DEFINER` auditada) tem **precedente no projeto** (`treatment_plan_steps.appointment_id`, feature 005) e preserva a imutabilidade do registro de uso (material/quantidade continuam imutáveis) |

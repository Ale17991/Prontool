# Implementation Plan: Sidebar enxuta + Configurações como hub

**Branch**: `014-sidebar-config-hub` | **Date**: 2026-05-18 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/014-sidebar-config-hub/spec.md`

## Summary

Feature **puramente UI/navegação** que (1) enxuga a sidebar para 3 + 3 + 1 itens, (2) move Notificações, Alertas e Pendências para uma página unificada `/operacao/notificacoes` com abas (acessada pelo sininho da topbar), (3) transforma `/configuracoes` num **hub com grid de cards** RBAC-filtered, e (4) move Auditoria de `/analise/auditoria` para `/configuracoes/auditoria` com 308 redirect. Zero mudanças em banco, RLS, route handlers de API ou contratos de eventos — apenas componentes Next.js + Tailwind. Toda a lógica RBAC server-side existente é reaproveitada (`can()` + role + feature flags).

## Technical Context

**Language/Version**: TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel)
**Primary Dependencies**: Next.js 14.2 (App Router), React 18.3, Tailwind CSS 3.4, shadcn/ui (Radix primitives), `lucide-react`. **Sem novas deps** — usa apenas o que já está no projeto.
**Storage**: N/A — feature pura de UI; nenhuma migration, RLS, função SQL ou bucket é tocado.
**Testing**: Vitest 1.6 (unit + integration). Testes de UI cobrindo (a) componente de sidebar com matriz role×flag, (b) hub `/configuracoes` filtrando cards por role, (c) tabs em `/operacao/notificacoes` mostrando sub-seções por permissão, (d) redirects 308 das rotas legadas.
**Target Platform**: Vercel (Edge + Node) servindo aplicação web Next.js dentro de `(dashboard)` SSR. Navegadores modernos (Chrome, Firefox, Safari, Edge — desktop e mobile).
**Project Type**: Web application monolítica (Next.js full-stack) — frontend e backend no mesmo repositório, mas esta feature toca **apenas** o frontend (`src/app/(dashboard)/...` + `src/app/(dashboard)/_components/`).
**Performance Goals**: Hub `/configuracoes` e página unificada de notificações SSR com TTFB / FCP **dentro da faixa atual** do dashboard (sem regressão observável A/B). Grid de 9 cards estáticos: <50 ms de render server-side; tabs client-side sem fetch adicional ao trocar.
**Constraints**:

- FR-016: pura UI — proibido tocar migrations/RLS/API handlers/eventos.
- Constituição III (multi-tenant): preservar — as páginas movidas já filtram por `tenant_id` via `getSession()` + RLS; mover a rota não muda essa cadeia.
- Constituição V (RBAC server-side): preservar — visibilidade dos cards continua avaliada no servidor com `getSession()` + `can()`, não apenas no client.
- Bundle: nenhum aumento significativo (apenas reorganização de componentes); zero novas deps.
  **Scale/Scope**: 4 user stories (P1×2, P2, P3), 17 FRs, 9 rotas tocadas (1 nova `/configuracoes` virando hub, 2 movidas, 3 com redirect 308, 3 alteradas via tabs).

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

Avaliação dos cinco princípios contra esta feature:

- **I. Integridade Financeira Imutável (NON-NEGOTIABLE)** — ✅ **N/A**. Nenhum código financeiro tocado; nenhuma migration; nenhum `UPDATE`/`DELETE` introduzido em tabelas financeiras.
- **II. Auditabilidade Total de Preços (NON-NEGOTIABLE)** — ✅ **N/A**. Nenhuma alteração em tabelas de preço/procedimento/convênio. A página de Auditoria muda de rota, mas o conteúdo, queries e trilha permanecem idênticos — apenas a URL canônica é diferente, com redirect 308 da antiga.
- **III. Isolamento Multi-Tenant** — ✅ **Preservado**. Cada página tocada continua chamando `getSession()` (que injeta `tenant_id`) e usando clientes Supabase com RLS por `tenant_id`. Mover páginas entre `/analise/` e `/configuracoes/` não altera essa cadeia; o hub é apenas um grid estático de cards que linka para essas mesmas páginas.
- **IV. Conformidade TUSS/ANS** — ✅ **N/A**. Catálogo TUSS, schemas TISS e cobrança não são tocados.
- **V. Segurança por Perfil de Acesso (RBAC)** — ⚠ **Relevante e preservado**.
  - O hub filtra cards no servidor com o mesmo predicado `({ role, flags }) => boolean` já usado pela sidebar atual em `dashboard-shell.tsx` — visibilidade NÃO é apenas client-side.
  - Cada subpágina (`/configuracoes/clinica`, `/configuracoes/usuarios`, etc.) **mantém** seu próprio check de RBAC server-side: esconder o card NÃO substitui a autorização da página de destino. Acesso direto à URL por um role sem permissão continua sendo negado pela própria página, como hoje.
  - Tabs em `/operacao/notificacoes` para Alertas/Pendências são montadas no servidor com base em `can(role, 'alert.read')` / `can(role, 'dlq.read')`. Sem permissão → a tab não é incluída no DOM (não é apenas escondida via CSS).

**Gate (pré-Phase 0): PASS** — nenhuma violação. Sem entradas em "Complexity Tracking".

**Re-check pós-Phase 1 (data-model + contracts)**: ✅ **PASS**. As decisões de design adicionadas (HUB_CARDS em módulo server-only, tabs server-rendered via `searchParams.tab`, redirects 308 via `permanentRedirect()`, mover código de auditoria com `git mv`) **mantêm** o RBAC server-side em todas as portas de entrada e não introduzem nenhum vetor novo de vazamento multi-tenant. Nenhuma nova fonte de dados; nenhum cliente Supabase novo; o filtro de cards no hub é avaliado no servidor antes da resposta (sem flash de UI proibida). Continua sem violações.

## Project Structure

### Documentation (this feature)

```text
specs/014-sidebar-config-hub/
├── plan.md              # This file (/speckit.plan command output)
├── spec.md              # Feature spec (already complete)
├── research.md          # Phase 0 output — decisões técnicas resolvidas
├── data-model.md        # Phase 1 output — sem entidades de domínio; documenta "schema" de Card
├── quickstart.md        # Phase 1 output — como rodar e validar localmente
├── contracts/
│   ├── routes.md        # Contrato de rotas: novas, mantidas, redirecionadas (com query strings)
│   ├── hub-cards.md     # Contrato do hub: ordem fixa, ícone, descrição, predicado RBAC
│   └── notifications-tabs.md  # Contrato das tabs em /operacao/notificacoes
├── checklists/
│   └── requirements.md  # Já criado em /speckit.specify (todos ✅)
└── tasks.md             # Phase 2 output (/speckit.tasks command — NÃO criado aqui)
```

### Source Code (repository root)

```text
src/
├── app/
│   └── (dashboard)/
│       ├── _components/
│       │   ├── dashboard-shell.tsx        # ALTERADO — sidebar enxugada (US1)
│       │   └── notification-bell.tsx      # MANTIDO — já linka para /operacao/notificacoes
│       ├── configuracoes/
│       │   ├── page.tsx                   # SUBSTITUÍDO — hub com grid de cards (US3); remove redirect role-based
│       │   ├── auditoria/
│       │   │   └── page.tsx               # NOVO — código movido de /analise/auditoria (US3/Q2)
│       │   ├── clinica/                   # MANTIDO
│       │   ├── perfil/                    # MANTIDO
│       │   ├── usuarios/                  # MANTIDO
│       │   ├── procedimentos/             # MANTIDO
│       │   ├── convenios/                 # MANTIDO
│       │   ├── profissionais/             # MANTIDO
│       │   ├── modelos-anamnese/          # MANTIDO
│       │   └── integracoes/               # MANTIDO
│       ├── operacao/
│       │   ├── notificacoes/
│       │   │   ├── page.tsx               # ALTERADO — passa a renderizar tabs (US2)
│       │   │   ├── _components/           # NOVO — Tabs (notificacoes | alertas | dlq) client component
│       │   │   ├── notification-item.tsx  # MANTIDO
│       │   │   └── mark-all-button.tsx    # MANTIDO
│       │   ├── alertas/
│       │   │   └── page.tsx               # ALTERADO — vira redirect 308 para /operacao/notificacoes?tab=alertas
│       │   └── dlq/
│       │       └── page.tsx               # ALTERADO — vira redirect 308 para /operacao/notificacoes?tab=dlq
│       └── analise/
│           └── auditoria/
│               └── page.tsx               # ALTERADO — vira redirect 308 para /configuracoes/auditoria (US3/Q2)
└── lib/
    └── auth/
        └── rbac.ts                        # MANTIDO — `can()` e roles existentes

tests/                                     # (mesma estrutura atual — vitest)
├── unit/
│   └── dashboard-shell-sections.test.ts   # NOVO — matriz role × seções/itens visíveis
├── integration/
│   ├── configuracoes-hub.test.ts          # NOVO — RBAC filtering de cards
│   ├── notificacoes-tabs.test.ts          # NOVO — tabs por permissão (alert.read, dlq.read)
│   └── legacy-route-redirects.test.ts     # NOVO — /analise/auditoria, /operacao/alertas, /operacao/dlq
```

**Structure Decision**: Projeto **web monolítico Next.js** (Option 2 simplificado — não há separação física frontend/backend; ambos vivem em `src/app/` com convenção App Router). Esta feature toca **apenas** componentes/pages dentro de `src/app/(dashboard)/` — o backend (route handlers em `src/app/api/`, libs em `src/lib/core/`, `src/lib/db/`, migrations) **NÃO É TOCADO**. A absorção das rotas legadas é feita com `redirect()` do `next/navigation` em Server Components, preservando query strings via `searchParams`.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

Nenhuma violação. Tabela omitida intencionalmente.

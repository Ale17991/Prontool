# Implementation Plan: Calendário de atendimentos, typeahead TUSS, catálogo odonto e navegação

**Branch**: `004-calendario-atendimentos` | **Date**: 2026-04-27 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/004-calendario-atendimentos/spec.md`

## Summary

Quatro entregas independentes na operação clínica da Prontool, ancoradas em uma única branch para que evoluam juntas mas se sustentem isoladamente:

1. **Calendário semanal de atendimentos com filtro multi-profissional** — view alternativa em `/operacao/atendimentos`, lendo o mesmo `appointments_effective` da Lista, renderizando blocos posicionados por hora/duração com cores por status. Acrescenta `duration_minutes` ao schema (default 30) e expõe filtro de profissional persistido em querystring.
2. **Typeahead TUSS com nome completo + "Ver em lista"** — popover já amplo (delivered em commit anterior); falta uniformizar nos demais formulários e adicionar drawer "Ver em lista" paginado a 20.
3. **Reconciliação do catálogo TUSS odonto contra ANS Jan/2025** — investigação prévia já confirmou que a Tabela 22 oficial não acrescenta nenhum prefixo 8x ao que temos. O artefato é uma migration documental que registra a versão fonte e um relatório (gerado pelo seed) para futuras auditorias.
4. **Botão "Voltar" em `/operacao/atendimentos/[id]` e `/novo`** — substitui o link textual por um botão visualmente claro, com `Link` direto para `/operacao/atendimentos` (não `router.back()`).

A entrega é monolítica (uma stack Next.js), então não há decisão "frontend vs backend" — tudo via App Router + Supabase. Estado do calendário (semana corrente, seleção de profissionais, granularidade) vai em querystring para preservar SSR e permitir compartilhar URL.

## Technical Context

**Language/Version**: TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel).
**Primary Dependencies**: Next.js 14.2 (App Router), React 18.3, `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind CSS 3.4, shadcn/ui (Radix primitives), `date-fns` 4.1, `framer-motion` 12, `lucide-react`.
**Storage**: PostgreSQL via Supabase (local dev: `supabase start`, porta 54321) com RLS por `tenant_id`. Tabelas tocadas: `appointments` (acrescenta `duration_minutes`), `tuss_codes` + `tuss_catalog_versions` (registro documental). Catálogo TUSS é leitura.
**Testing**: Vitest (unit + integration via `pnpm test`/`pnpm test:integration`/`pnpm test:contract`). Playwright para UI snapshots em fluxos críticos (calendário). `pnpm typecheck` em CI.
**Target Platform**: Web (responsive desktop + mobile), runtime Vercel Edge/Serverless.
**Project Type**: Web app (Next.js single-project — não é monorepo; convenção do CLAUDE.md raiz).
**Performance Goals**: Calendário de 1 semana com até 60 atendimentos renderizado em ≤ 1,5 s (SC-002); filtro de profissional aplica em ≤ 500 ms (SC-004 — interação client-side, sem round-trip).
**Constraints**: Imutabilidade financeira (Princípio I) — `duration_minutes` em atendimentos passados é NULL e renderiza com default 30 sem mutar o registro; só novos atendimentos persistem o campo. RLS por `tenant_id` em todas as queries (Princípio III). Nada de `process.env.GHL_*` em adapters (lint:auth). Timestamps UTC, conversão para fuso da clínica só na apresentação.
**Scale/Scope**: ~1k atendimentos/mês por clínica média; ~200 clínicas (multi-tenant). Catálogo TUSS ~6k linhas (consulta paginada/typeahead, não impacta listagem). Esta feature toca 4 páginas + 1 migration + 2 server components novos + 3 client components novos.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Princípio                                    | Toca?    | Análise                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **I. Integridade Financeira Imutável**       | Indireto | Nenhum valor financeiro é alterado. `duration_minutes` é metadado operacional não-financeiro. Atendimentos antigos sem o campo permanecem como estão (NULL → renderização usa default na apresentação, sem UPDATE). PASS.                                                                                                                                                                                                 |
| **II. Auditabilidade Total de Preços**       | Não      | Sem mudança em tabelas de preço/comissão. Calendário é apenas leitura. Mudança de `duration_minutes` futura (US fora deste escopo) precisará de auditoria — a coluna já fica preparada para isso. PASS.                                                                                                                                                                                                                   |
| **III. Isolamento Multi-Tenant**             | Sim      | Toda query do calendário e do typeahead "Ver em lista" precisa filtrar por `tenant_id` (RLS já aplicado a `appointments_effective`). Adapter de fetch reutiliza o cliente server SSR (`createSupabaseServerClient`) que já injeta o tenant via cookie de sessão. Filtro de profissional usa `doctors` da mesma clínica (já scoped). PASS — nenhum endpoint novo recebe `tenant_id` do cliente.                            |
| **IV. Conformidade TUSS/ANS**                | Sim      | US4 reconcilia o catálogo contra a publicação oficial ANS 202501; investigação prévia provou que **0 códigos odonto faltam** vs. a fonte oficial e que prefixo 88 não existe. A migration nesta entrega serve para registrar a versão de catálogo fonte (`tuss_catalog_versions` row) sem acrescentar códigos — preserva auditabilidade. Códigos não-odonto faltantes (241 medical) são fora de escopo deste plano. PASS. |
| **V. Segurança por Perfil de Acesso (RBAC)** | Sim      | Calendário é leitura para os mesmos papéis que já enxergam a Lista (`requireRole` herdado da rota); criar atendimento via slot vazio reutiliza o mesmo gate de `/operacao/atendimentos/novo` (admin/recepcionista). Botão "Voltar" não exige autorização adicional. Drawer "Ver em lista" usa endpoint `/api/tuss-codes` existente, que já é leitura autenticada. PASS.                                                   |

**Gates**: Todos passam. Sem violações para registrar em "Complexity Tracking".

## Project Structure

### Documentation (this feature)

```text
specs/004-calendario-atendimentos/
├── plan.md              # This file
├── spec.md              # Feature spec (already written)
├── research.md          # Phase 0 — decisões técnicas
├── data-model.md        # Phase 1 — entidades + migration
├── quickstart.md        # Phase 1 — como rodar/testar local
├── contracts/           # Phase 1 — contratos UI (props) e SQL
│   ├── appointments-week-fetch.md
│   ├── tuss-list-drawer.md
│   └── duration-minutes-migration.md
├── checklists/
│   └── requirements.md  # Já criado pelo /speckit.specify
└── tasks.md             # Phase 2 (criado por /speckit.tasks — fora deste comando)
```

### Source Code (repository root)

Estrutura existente (Next.js App Router, single project) — esta feature acrescenta arquivos sem mover nada:

```text
src/
├── app/
│   └── (dashboard)/
│       └── operacao/
│           └── atendimentos/
│               ├── page.tsx                    # MODIFICA: adiciona toggle Lista/Calendário, server-fetch da semana
│               ├── atendimentos-toolbar.tsx    # NOVO (client): toggle Lista/Calendário + nav semana + filtro pros
│               ├── calendar/
│               │   ├── calendar-view.tsx       # NOVO (client): grid sem-sáb × 07-22h, blocos posicionados
│               │   ├── calendar-block.tsx      # NOVO (client): bloco individual com cor/altura
│               │   ├── current-time-line.tsx   # NOVO (client): linha vermelha auto-update
│               │   └── doctor-filter.tsx       # NOVO (client): popover multi-select
│               ├── [id]/
│               │   └── page.tsx                # MODIFICA: substitui link textual por botão Voltar
│               └── novo/
│                   ├── page.tsx                # MODIFICA: aceita ?at=ISO, pré-preenche, botão Voltar
│                   └── new-appointment-form.tsx# MODIFICA: campo duration_minutes (default 30)
├── components/
│   └── tuss/
│       ├── tuss-list-dialog.tsx                # NOVO (client): drawer "Ver em lista" paginado a 20
│       └── tuss-typeahead.tsx                  # NOVO (client): wrapper compartilhado dos typeaheads TUSS
├── lib/
│   └── core/
│       └── appointments/
│           └── list-week.ts                    # NOVO: query de atendimentos por intervalo + tenant + doctors
└── lib/utils/
    └── calendar.ts                             # NOVO: helpers semana/slot/posicionamento (puro TS, testável)

supabase/
└── migrations/
    └── 0053_appointments_duration_and_catalog_version.sql   # NOVO

tests/
├── unit/
│   └── calendar-utils.spec.ts                  # NOVO — pure helpers (sem DB)
├── integration/
│   └── atendimentos-calendar.spec.ts           # NOVO — fluxo SSR + filtro
└── e2e/
    └── calendar.spec.ts                        # NOVO — Playwright (smoke do toggle + slot click)

scripts/
└── tuss-odonto-audit.ts                        # NOVO — relatório de reconciliação (offline; usa .tmp/ baixado)
```

**Structure Decision**: Single Next.js project, App Router. Toda a feature mora dentro de `src/app/(dashboard)/operacao/atendimentos/` com ramificação por sub-rota (`calendar/`) para componentes do calendário, e em `src/components/tuss/` para componentes TUSS reutilizados pelos diferentes formulários. Nenhum monorepo, nenhuma separação backend/frontend — App Router consolida server components + route handlers + client components numa só árvore. Esta escolha está alinhada com `CLAUDE.md` e com as features 001/002/003 anteriores.

## Phase 0 — Research

Output em [`research.md`](./research.md). Decisões-chave resolvidas:

1. **Como representar `duration_minutes`** — coluna nova em `appointments`, NULLABLE para preservar imutabilidade dos passados, default `30` aplicado na camada de leitura (não no banco) para que registros antigos não sejam mutados. **Decisão: ADD COLUMN sem default; cliente lê com COALESCE.**
2. **Estado do calendário (semana, profissionais, granularidade)** — querystring (`?view=cal&week=YYYY-MM-DD&doctors=id1,id2&grain=week`). **Decisão: querystring, não cookie/localStorage**, para SSR-friendly + URL compartilhável + back/forward do navegador funcionando.
3. **Library de calendário** — `react-big-calendar`, `fullcalendar`, ou implementação custom. **Decisão: custom com Tailwind grid**. Justifica-se pela simplicidade dos requisitos (07–22h, slot 1h fixo), bundle menor, e controle total do styling para combinar com o sistema. `date-fns` cobre toda a aritmética de datas.
4. **Pré-preenchimento da hora ao clicar em slot vazio** — `/operacao/atendimentos/novo?at=2026-05-04T14:00:00-03:00`. Form lê `searchParams.at` e converte para `datetime-local`. **Decisão: querystring `at` em ISO local com offset.**
5. **Drawer "Ver em lista" para TUSS** — usar Radix Dialog (já em uso) ou shadcn Sheet. **Decisão: shadcn Dialog em modo `max-w-3xl`** (table-friendly), reutiliza endpoint `/api/tuss-codes` existente com paginação client-side de 20.
6. **Filtro multi-profissional persistente** — querystring `doctors=id1,id2`. Lista vem de `doctors` (mesmo tenant). Inativos aparecem com badge. **Decisão: rendering server-side da lista; toggle no client com `<Popover>` + checklist + botão "Aplicar".**
7. **Linha de hora atual** — atualiza a cada minuto via `setInterval` em client component. **Decisão: 60s; não mais frequente para evitar re-render desnecessário.**
8. **Sobreposição de blocos no mesmo slot** — algoritmo simples: agrupar por dia, ordenar por start, calcular "lanes" (Welsh-Powell-light), max 4 lanes; >4 colapsa para "+N mais". **Decisão: implementação inline em `calendar.ts` (sem lib externa).**
9. **Mobile breakpoint para forçar Day view** — Tailwind `< sm` (640px). **Decisão: rendering condicional do grain via media query no client.**
10. **Reconciliação odonto** — script offline que baixa o XLSX oficial ANS 202501, compara com `tuss_codes` local, e imprime relatório por prefixo. Não importa códigos novos (já provamos que não há). **Decisão: script `scripts/tuss-odonto-audit.ts`, comando `pnpm seed:tuss:audit-odonto`. Migration 0053 acrescenta apenas a row de `tuss_catalog_versions` documentando a versão 202501 como referência.**

## Phase 1 — Design & Contracts

Outputs em [`data-model.md`](./data-model.md), [`quickstart.md`](./quickstart.md), e [`contracts/`](./contracts/).

### Data model summary

| Entidade                 | Mudança                                                                               | Detalhes                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `appointments`           | ADD COLUMN `duration_minutes INTEGER NULL CHECK (duration_minutes BETWEEN 5 AND 480)` | Default 30 aplicado em leitura via COALESCE. NULL permitido para preservar registros antigos.                               |
| `tuss_catalog_versions`  | INSERT row                                                                            | `source_ref='ans_official_202501'`, documentando a fonte oficial de reconciliação. Não toca `tuss_codes`.                   |
| `appointments_effective` | RECREATE VIEW                                                                         | Inclui `duration_minutes` na seleção (`a.*` já inclui via `*`, mas explicitar para evitar surpresas em migrations futuras). |

Sem novas tabelas. Sem alteração de RLS — `appointments` já tem policy por `tenant_id`.

### Contracts summary

- **`contracts/appointments-week-fetch.md`** — input/output da função `listAppointmentsForWeek(supabase, { tenantId, weekStart, weekEnd, doctorIds })` em `src/lib/core/appointments/list-week.ts`. Inclui campos selecionados, joins (`patients`, `procedures`, `doctors`), e shape de DTO consumido pelo client component.
- **`contracts/tuss-list-drawer.md`** — props do componente `<TussListDialog>` (open/onOpenChange, table param, onSelect callback) e contrato da query: paginação client-side (página 1..N de 20 itens), busca por código ou descrição reutilizando `/api/tuss-codes?q=...&table=...&limit=200`.
- **`contracts/duration-minutes-migration.md`** — SQL completo da 0053, incluindo o `INSERT INTO tuss_catalog_versions` documental, e teste de regressão (`SELECT count(*) FROM appointments WHERE duration_minutes IS NOT NULL` deve crescer só com novos registros).

### Quickstart

`quickstart.md` cobre:

1. `git checkout 004-calendario-atendimentos`
2. `pnpm install` (sem deps novas)
3. `supabase start` + `pnpm supabase:reset` (aplica 0053)
4. `pnpm dev` → abrir `/operacao/atendimentos`, alternar para Calendário, navegar semanas, filtrar por profissional
5. Rodar `pnpm seed:tuss:audit-odonto` para gerar o relatório de reconciliação no console
6. Rodar `pnpm test`, `pnpm test:contract`, `pnpm typecheck`

### Agent context update

Roda `.specify/scripts/powershell/update-agent-context.ps1 -AgentType claude` ao final do plan para que o `CLAUDE.md` raiz absorva: nova rota `/operacao/atendimentos?view=cal`, nova coluna `duration_minutes`, novo helper `src/lib/utils/calendar.ts`, e novo script de auditoria.

## Re-evaluation post-Phase 1

Re-checagem dos princípios após o desenho detalhado:

- **I. Imutabilidade**: `duration_minutes` é NULLABLE; nenhum UPDATE em registros existentes. PASS (reconfirmado).
- **II. Auditoria de preços**: Nenhuma alteração em preço/comissão. PASS.
- **III. Multi-tenant**: Toda query passa pelo cliente Supabase server (SSR), com RLS já em vigor. Filtro de profissional limita por `doctor_id` apenas dentro do tenant atual. PASS.
- **IV. TUSS/ANS**: Migration 0053 não muta códigos; só registra versão. Audit script reconcilia e reporta. PASS.
- **V. RBAC**: Calendário herda gate da rota Lista; criar atendimento herda gate de `/novo`. PASS.

Sem violações pós-design. Plano aprovado para Phase 2 (`/speckit.tasks`).

## Complexity Tracking

> Sem violações de constituição — tabela vazia.

| Violation | Why Needed | Simpler Alternative Rejected Because |
| --------- | ---------- | ------------------------------------ |
| _(none)_  | _(none)_   | _(none)_                             |

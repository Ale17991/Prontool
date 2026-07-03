# Implementation Plan: Detalhe do Atendimento como Painel Lateral na Agenda

**Branch**: `025-agenda-sheet-modal` | **Date**: 2026-05-25 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/025-agenda-sheet-modal/spec.md`

## Summary

Permitir que o usuário abra o detalhe de um atendimento sem sair da agenda (lista ou calendário) — clicar em um item exibe um painel lateral (Sheet) com o mesmo conteúdo da página standalone e as ações de status já existentes (confirmar, presença, cancelar, estornar). Fechar o painel devolve scroll/filtros intactos. A rota `/operacao/atendimentos/[id]` permanece como deep-link.

Abordagem técnica deliberadamente conservadora — restrições derivadas do incidente do commit revertido `f1c08c4`:

- **Sem intercepting routes**: o painel é controlado por `useState` num Client Component que wrappa a árvore da agenda; clique em `<a>` de atendimento é interceptado client-side (preserva ctrl/middle-click) e abre o Sheet.
- **Sem `createSupabaseServiceClient()` em componente compartilhado**: dados vêm de `GET /api/atendimentos/[id]` via fetch client. Esse endpoint já existe e já valida tenant/roles.
- **Reuso 100% dos forms de ação existentes** (`ConfirmAppointmentButton`, `CancelAppointmentForm`, `MarkRealizedForm`, `ReversalForm`) — eles já fazem POST + `router.refresh()`. Painel passa um callback `onSuccess` para também disparar `refetch()` interno do detalhe.
- **Reload da agenda** após ação: `router.refresh()` (já é o que os forms fazem) — re-renderiza o RSC da lista sem perder estado de filtro client-side.

## Technical Context

**Language/Version**: TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel).
**Primary Dependencies**: Next.js 14.2 (App Router + Server Actions + RSC), React 18.3, shadcn/ui (`Sheet` já presente em `src/components/ui/sheet.tsx`, baseado em `@radix-ui/react-dialog`), `lucide-react`, Tailwind CSS 3.4. **Sem novas deps.**
**Storage**: N/A — feature pura de UI/orquestração. Não toca em migrations, RLS, funções SQL ou buckets.
**Testing**: vitest (suite existente) + validação manual via `pnpm dev` antes do deploy (constraint da spec).
**Target Platform**: Vercel (Next.js production), browsers modernos (desktop + mobile responsivo ≥768px breakpoint `md`).
**Project Type**: web (Next.js App Router monorepo single-package).
**Performance Goals**: Painel visível com loading em <300ms (SC-001); dados carregados em <2s para 95% dos casos (SC-002); agenda subjacente atualiza em <2s pós-ação (SC-003).
**Constraints**:

- Proibido usar intercepting/parallel routes (`@modal/(.)[id]` ou similar).
- Proibido importar `createSupabaseServiceClient` em arquivos sob `_components/` ou outros que possam virar chunk compartilhado.
- Não introduzir nova dependência de runtime.
- Página standalone `[id]/page.tsx` permanece intocada.
  **Scale/Scope**:
- ~600 linhas de conteúdo de detalhe (já existe na page standalone) — não duplicar; vamos extrair o JSX de renderização para um Client Component novo que recebe dados via props (fetched client-side).
- Painel aberto 10–30× por sessão típica de recepção.
- 1 painel aberto por vez (não há multi-painel).

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Princípio                                    | Status  | Justificativa                                                                                                                                                                                                                                                                                  |
| -------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **I. Integridade Financeira Imutável**       | ✅ N/A  | Feature é UI; não persiste, não altera registros financeiros.                                                                                                                                                                                                                                  |
| **II. Auditabilidade Total de Preços**       | ✅ N/A  | Não muda preços nem catálogos. Ações de status (confirmar/cancelar/estornar) já são auditadas pelos endpoints existentes — feature só roteia para os mesmos endpoints.                                                                                                                         |
| **III. Isolamento Multi-Tenant**             | ✅ Pass | Painel consome `GET /api/atendimentos/[id]` que já aplica `requireRole + tenant filter`. Nenhum query novo ao banco. RLS continua a defesa primária.                                                                                                                                           |
| **IV. Conformidade TUSS/ANS**                | ✅ N/A  | Feature não toca em catálogo TUSS nem em integrações ANS/TISS.                                                                                                                                                                                                                                 |
| **V. Segurança por Perfil de Acesso (RBAC)** | ✅ Pass | FR-012 manda respeitar permissões. Painel oculta botões via UI **apenas como UX** — a autorização real continua server-side nos endpoints `/api/atendimentos/[id]/{confirmar,cancelar,realizado,reversal}` (todos chamam `requireRole`). Lint:auth já valida que essas rotas estão protegidas. |

**Sem violações. Complexity Tracking vazio.**

Defense-in-depth observada na restrição "proibido `createSupabaseServiceClient` em `_components/`": é exatamente o que o `assertCallerAllowed()` guard tenta impor, e a regressão histórica (commit `f1c08c4`) prova que essa constraint precisa estar na spec, não só no runtime.

## Project Structure

### Documentation (this feature)

```text
specs/025-agenda-sheet-modal/
├── plan.md              # Este arquivo
├── research.md          # Phase 0 — decisões técnicas (sem intercepting routes; Sheet + estado client; reuso dos forms)
├── data-model.md        # Phase 1 — Atendimento (read-only consumido; sem mudança de schema)
├── contracts/
│   └── consumed-endpoints.md  # Endpoints já existentes que o painel consome (não estamos criando endpoints novos)
├── quickstart.md        # Phase 1 — roteiro de validação local antes do deploy
├── checklists/
│   └── requirements.md  # Já gerado por /speckit-specify
└── tasks.md             # Phase 2 output (gerado por /speckit-tasks)
```

### Source Code (repository root)

```text
src/
├── app/(dashboard)/operacao/atendimentos/
│   ├── _components/                                  [NOVO — Client Components]
│   │   ├── appointment-detail-panel.tsx              [NOVO — Sheet wrapper + fetch + montagem do conteúdo]
│   │   ├── appointment-detail-body.tsx               [NOVO — renderização pura dos dados (sem fetch interno)]
│   │   ├── appointment-detail-host.tsx               [NOVO — intercepta clicks em <a> com data-appointment-id]
│   │   └── use-appointment-detail.ts                 [NOVO — hook { data, loading, error, refetch }]
│   ├── page.tsx                                      [MODIFICADO — wrapper Host envolve tabela; <Link> ganha data-attr]
│   ├── calendar/
│   │   └── ... (mesmo padrão: <Host> envolve grid do calendário; cliques nos blocos viram data-attr)
│   ├── [id]/
│   │   ├── page.tsx                                  [INTOCADO — rota standalone permanece a mesma]
│   │   ├── confirm-button.tsx                        [MODIFICADO — aceita prop opcional onSuccess?: () => void]
│   │   ├── cancel-form.tsx                           [MODIFICADO — onSuccess?: () => void + onDirtyChange?: (dirty: boolean) => void]
│   │   ├── mark-realized-form.tsx                    [MODIFICADO — onSuccess?: () => void]
│   │   └── reversal-form.tsx                         [MODIFICADO — onSuccess?: () => void + onDirtyChange?]
│   └── novo, bloquear, components/                   [INTOCADOS]
└── components/ui/sheet.tsx                           [INTOCADO — já existe]

tests/
└── unit/
    └── appointment-detail-panel.spec.tsx             [NOVO — testes do hook + comportamento de fechamento com form sujo]
```

**Structure Decision**: Single-project Next.js App Router (já estabelecido). Tudo novo cai sob `src/app/(dashboard)/operacao/atendimentos/_components/`. A pasta `_components/` com prefixo `_` é tratada pelo Next como private folder (não vira rota). O conteúdo é puramente Client — não importa `createSupabaseServiceClient`, então mesmo quando o Next bundla em chunks (perdendo `/app/` na stack), nenhum guard é violado.

## Complexity Tracking

> _Nenhuma violação da Constituição — seção intencionalmente vazia._

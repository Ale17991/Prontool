# Implementation Plan: Responsividade total (mobile, tablet e desktop)

**Branch**: `003-responsive-design` | **Date**: 2026-04-27 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/003-responsive-design/spec.md`

## Summary

Tornar o Prontool utilizável em qualquer viewport entre 360px e 1920px sem regressão visual no desktop atual. Implementação restrita a componentes de layout e estilos: a sidebar permanente vira drawer off-canvas (Sheet do shadcn/ui) controlado por hamburger em <768px; tab bar de categoria ganha overflow-x-auto com auto-scroll para a aba ativa; Dialog base ganha `max-h-[90vh] overflow-y-auto`; padding global do shell muda de `p-8` fixo para `p-4 md:p-8`; tabelas ganham indicador visual de scroll horizontal via fade gradients nas bordas; action bars que faltavam wrap recebem `flex-wrap` ou `flex-col md:flex-row`. Zero mudanças em backend, banco, APIs, ou regras de RBAC.

## Technical Context

**Language/Version**: TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel)
**Primary Dependencies**: Next.js 14.2 (App Router), React 18.3, Tailwind CSS 3.4, shadcn/ui (Radix primitives), framer-motion 12, lucide-react
**Storage**: N/A — feature de UI pura, não persiste nada
**Testing**: Playwright 1.45 para regressão visual (screenshots antes/depois @1280×720) + smoke flow existente (`tests/e2e/smoke-flow.spec.ts`) + Vitest typecheck/lint
**Target Platform**: Browsers modernos (Chromium, Firefox, Safari) em viewports 360-1920px largura
**Project Type**: Web application (Next.js full-stack) — mudanças concentradas em `src/app/(dashboard)/_components/` e `src/components/ui/`
**Performance Goals**: Drawer abre/fecha em ≤300ms percebidos; sem layout thrashing ao redimensionar; nenhum aumento relevante em JS bundle (Sheet do shadcn ~3KB gzipped, Radix dialog primitive já está no bundle pelo Dialog existente)
**Constraints**: Zero regressão visual em viewports ≥1024px (validada por Playwright snapshot @1280×720); zero mudanças em backend/banco/RBAC; preservar comportamento de todos os fluxos do smoke test atual
**Scale/Scope**: 1 componente Shell (DashboardShell), 1 componente UI base (Dialog), 1 componente UI a adicionar (Sheet), ~3 ajustes pontuais em pages (action bars, table fade gradient). Total: ~6 arquivos tocados.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Princípio                                    | Toca? | Avaliação                                                                                                                                                             |
| -------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **I. Integridade Financeira Imutável**       | Não   | Feature é puramente visual — não escreve, lê, ou exibe valores históricos de forma diferente. Não cria nem modifica registros financeiros. **PASS**.                  |
| **II. Auditabilidade Total de Preços**       | Não   | Não altera fluxos de mudança de preço, nem toca em `audit_log`. **PASS**.                                                                                             |
| **III. Isolamento Multi-Tenant**             | Não   | Sem novas queries, sem mudanças em RLS, sem mudanças em filtros por `tenant_id`. **PASS**.                                                                            |
| **IV. Conformidade TUSS/ANS**                | Não   | Sem toque em catálogo TUSS ou validações ANS. **PASS**.                                                                                                               |
| **V. Segurança por Perfil de Acesso (RBAC)** | Não   | Sem mudanças em `requireRole`, em policies, ou em controles UI/API. O drawer mostra exatamente os mesmos itens filtrados por role que a sidebar fixa atual. **PASS**. |

**Resultado**: Todos os 5 gates passam. Sem violations a justificar em Complexity Tracking.

**Re-check pós-Phase 1**: revalidar após pesquisa estar concluída — sem previsão de surgir violação nova (escopo de UI estilizado).

## Project Structure

### Documentation (this feature)

```text
specs/003-responsive-design/
├── plan.md              # This file (/speckit.plan command output)
├── spec.md              # Feature spec
├── research.md          # Phase 0 output
├── quickstart.md        # Phase 1 output (como validar a entrega)
├── checklists/
│   └── requirements.md  # Validação de qualidade da spec
└── tasks.md             # Phase 2 output (/speckit.tasks — não criado aqui)
```

(`data-model.md` e `contracts/` **não se aplicam** — feature de UI sem novas entidades nem novas APIs.)

### Source Code (repository root)

Apenas arquivos sob `src/` e `tests/` são tocados. Estrutura existente preservada:

```text
src/
├── app/
│   ├── (auth)/login/page.tsx                      # já responsivo — sem mudança
│   └── (dashboard)/
│       ├── _components/
│       │   ├── dashboard-shell.tsx                # ALTERADO — drawer + padding responsive
│       │   └── sidebar-integrations-badge.tsx     # sem mudança
│       ├── operacao/pacientes/[id]/
│       │   └── page.tsx                            # ALTERADO — action bar header com flex-wrap
│       └── ...                                    # outras pages — sem mudança (forms já responsive)
└── components/
    └── ui/
        ├── dialog.tsx                              # ALTERADO — max-h + overflow-y-auto + p responsive
        ├── sheet.tsx                               # NOVO — adicionado do shadcn/ui
        └── table.tsx                               # ALTERADO — wrapper com fade gradient

tests/
└── e2e/
    ├── smoke-flow.spec.ts                          # sem mudança — valida não-regressão
    └── responsive-snapshots.spec.ts                # NOVO — Playwright screenshots @1280×720
```

**Structure Decision**: web application (Next.js App Router já estabelecido). Não criamos nova hierarquia — apenas modificamos `_components/dashboard-shell.tsx` e `components/ui/{dialog,table}.tsx` e adicionamos `components/ui/sheet.tsx` (drop-in do shadcn).

## Complexity Tracking

> Sem violations à constitution. Tabela vazia.

| Violation | Why Needed | Simpler Alternative Rejected Because |
| --------- | ---------- | ------------------------------------ |
| (none)    | —          | —                                    |

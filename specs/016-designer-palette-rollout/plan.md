# Implementation Plan: Rollout da Paleta Híbrida do Designer

**Branch**: `016-designer-palette-rollout` | **Date**: 2026-05-18 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/016-designer-palette-rollout/spec.md`

## Summary

Aplicar ao código do Prontool a paleta híbrida do designer (azul institucional + verde accent + Blue 600 mantido em CTA), introduzir tokens semânticos faltantes (`success`/`warning`/`info`/`alert` + variantes `*-bg`/`*-text`), escala tipográfica nomeada (7 níveis), badge unificado de status de atendimento (7 estados com cor + ícone + label, `prefers-reduced-motion` respeitado), substituir o slate-900 da sidebar pelo `#0E3C5B`, migrar Inter para `next/font/google` preservando `cv11`/`ss01`, e remover a declaração de dark mode inoperante.

**Abordagem técnica** (derivada do `research.md`):

- Tokens HSL em `globals.css` para a paleta principal + tokens RGBA diretos para a sidebar (carregam alpha intrínseca).
- `--primary` permanece `217 91% 60%` (Blue 600); CTA não muda.
- Componente `AppointmentStatusBadge` cobre 7 estados visuais; call-sites atuais instanciam só 3 (`agendado`/`ativo`/`estornado` do banco), os outros 4 ficam disponíveis para domínio futuro.
- `motion-safe:animate-pulse` no estado "em atendimento" — fallback estático automático via variant nativa do Tailwind.
- Ícones Lucide já presentes — sem upgrade de dependência.
- Inter via `next/font/google` com `display: 'swap'` + `variable: '--font-sans'`; `font-feature-settings: 'cv11', 'ss01'` permanece declarado em CSS.

## Technical Context

**Language/Version**: TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel)
**Primary Dependencies**: Next.js 14.2 (App Router), React 18.3, Tailwind CSS 3.4, shadcn/ui (Radix primitives), `lucide-react ^1.8.0` (já instalado; ícones verificados), `next/font/google` (novo uso, sem nova dep — já em Next.js)
**Storage**: N/A (feature pura de UI/CSS — `FR-027` proíbe qualquer mudança em DB)
**Testing**: Vitest existente para o restante do projeto; nesta feature, validação por inventário + inspeção visual + `pnpm typecheck`. Sem novos arquivos de teste automatizados (decisão registrada nas Assumptions do spec).
**Target Platform**: Web — desktop primário; mobile/tablet preservados (Feature 003 cobre responsive design; esta feature não regride).
**Project Type**: Web application — single Next.js project (estrutura existente em `src/app`, `src/components`, `src/lib`).
**Performance Goals**: LCP ≥ 100ms menor (ou ausência confirmada de FOUT) no login e dashboard inicial em conexão 3G emulada; zero requisições a `fonts.googleapis.com` em runtime.
**Constraints**: WCAG AA contraste ≥ 4.5:1 texto / ≥ 3:1 UI; `prefers-reduced-motion: reduce` respeitado (SC-013); fidelidade hex ao designer (SC-001); preservar `cv11`/`ss01` (FR-020); nenhuma mudança em DB/RLS/migrations (FR-027); typecheck obrigatório após cada commit (FR-030).
**Scale/Scope**: ~6 arquivos editados + 1 arquivo novo (`appointment-status-badge.tsx`). Impacto em ~5 telas-chave (login, dashboard, agenda calendário, agenda lista, ficha paciente, relatórios). 8 hex codes na paleta híbrida → 19 tokens CSS (11 semânticos + 8 sidebar). 7 variantes visuais no badge.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Aplicabilidade | Status |
|---|---|---|
| **I. Integridade Financeira Imutável** | N/A — esta feature não toca em valores, faturas, preços, ajustes ou estornos. Nenhum `UPDATE`/`DELETE` em dados financeiros é introduzido. | ✅ Pass |
| **II. Auditabilidade Total de Preços** | N/A — nenhum cadastro auditável é alterado. A mudança de classes CSS em componentes de UI não gera eventos de domínio. | ✅ Pass |
| **III. Isolamento Multi-Tenant** | N/A direta. Verificação indireta: a sidebar é reestilizada, mas o **link "Trocar clínica"** (que depende de `availableTenants` por usuário) **mantém** sua lógica intacta — apenas a cor muda (`text-sky-300` → `text-sidebar-switch`). Nenhuma consulta nova ao banco; nenhum `tenant_id` é manipulado. | ✅ Pass |
| **IV. Conformidade TUSS/ANS** | N/A — esta feature não toca em códigos, catálogos, validações TUSS, nem em integração TISS/XML. | ✅ Pass |
| **V. Segurança por Perfil de Acesso (RBAC)** | N/A direta. Verificação indireta: nenhum botão/ação muda de visibilidade nem de gating; apenas aparência muda. RBAC server-side permanece como única fonte de autorização. Itens da sidebar continuam sendo filtrados conforme `session.role` pelo `dashboard-shell.tsx` existente. | ✅ Pass |

**Gates adicionais (Quality)**:
- **Migration**: Sem migrations. ✅
- **Append-only**: Sem persistência tocada. ✅
- **LGPD**: Sem dados pessoais/saúde tocados. ✅
- **Tokens/segredos**: Sem nova dep externa, sem nova env var. ✅
- **Observabilidade**: Sem novos eventos estruturados (feature de UI). ✅
- **Revisão**: PRs desta feature **NÃO** tocam código financeiro/RBAC/tenant scoping/TUSS — revisão padrão suficiente. ✅

**Resultado do gate**: ✅ **PASS** — Nenhuma violação. Sem entradas em "Complexity Tracking".

## Project Structure

### Documentation (this feature)

```text
specs/016-designer-palette-rollout/
├── spec.md                                 # Feature specification (entregue por /speckit-specify + /speckit-clarify)
├── plan.md                                 # Este arquivo (/speckit-plan output)
├── research.md                             # Phase 0 — decisões técnicas resolvidas
├── data-model.md                           # Phase 1 — entidades-conceito (tokens, status, escala tipográfica)
├── quickstart.md                           # Phase 1 — como usar o que foi entregue
├── contracts/
│   ├── tokens.schema.json                  # Phase 1 — lista canônica dos tokens CSS expostos
│   ├── appointment-status-badge.contract.md # Phase 1 — props + comportamento + a11y do componente
│   └── typography-scale.contract.md         # Phase 1 — classes utilitárias e regra ≥ 12px
├── checklists/
│   └── requirements.md                     # Validação de qualidade do spec (já entregue)
└── tasks.md                                # Phase 2 — gerado por /speckit-tasks (NÃO criado por /speckit-plan)
```

### Source Code (repository root)

A feature edita arquivos existentes do projeto Next.js single-app e adiciona **um** componente novo. Sem mudanças estruturais de pastas.

```text
src/
├── app/
│   ├── globals.css                         # [EDIT] +13 tokens novos, escala tipográfica, remoção .dark órfã
│   ├── layout.tsx                          # [EDIT] migra Inter para next/font/google
│   └── (dashboard)/
│       └── _components/
│           └── dashboard-shell.tsx         # [EDIT] sidebar consome tokens (8 substituições)
├── components/
│   └── ui/
│       ├── appointment-status-badge.tsx    # [NEW] componente único de status (7 variantes)
│       └── [demais shadcn]                 # [TOUCH-ONLY se necessário] herdam tokens automaticamente
├── app/(dashboard)/operacao/atendimentos/
│   └── calendar/
│       └── calendar-block.tsx              # [EDIT] consome AppointmentStatusBadge (substitui statusClass inline)
└── lib/
    └── [sem mudanças]

tailwind.config.ts                          # [EDIT] +tokens semânticos, +tokens sidebar, REMOVE darkMode: ['class']
package.json                                # [SEM EDIT — todas as deps já estão presentes]
```

**Estrutura escolhida**: **Single Next.js project (existente)** — esta feature não justifica reorganização de diretórios. Caminhos reais estão acima.

**Outros call-sites de status de appointment** (a auditar e migrar durante implementação):
- `src/app/(dashboard)/operacao/atendimentos/calendar/calendar-block.tsx` (confirmado)
- `appointments-history-table.tsx` (confirmado via grep)
- `filter-bar.tsx` (confirmado via grep)
- **Inventário no início da US2** para encontrar quaisquer outros.

## Phases

### Phase 0 — Outline & Research ✅ COMPLETO

Output: [research.md](./research.md). Resolveu:
- Conversão hex → HSL para 11 valores cromáticos.
- Estratégia `next/font/google` + preservação `cv11`/`ss01`.
- Descoberta crítica: banco tem só 3 estados de appointment (`ativo`/`agendado`/`estornado`); componente cobre 7 visuais para evolução futura.
- `motion-safe:animate-pulse` para "em atendimento".
- Confirmação de ícones Lucide presentes na versão instalada.
- Tokens da sidebar como RGBA direto (não HSL).
- Inventário de divergências exatas em `dashboard-shell.tsx`.
- Pré-cálculo de contraste WCAG AA para 7 pares críticos.

Zero `NEEDS CLARIFICATION` remanescente.

### Phase 1 — Design & Contracts (este passo)

Outputs:
- `data-model.md` — entidades-conceito do design system (tokens, status, escala tipográfica) tratadas como "modelo de dados" da feature, mesmo sendo UI.
- `contracts/tokens.schema.json` — schema JSON canônico dos tokens expostos.
- `contracts/appointment-status-badge.contract.md` — props + acceptance de UX.
- `contracts/typography-scale.contract.md` — classes utilitárias + regra ≥ 12px.
- `quickstart.md` — receita prática para usar o sistema entregue.
- Atualização de CLAUDE.md via script.

### Phase 2 — Tasks (gerado por `/speckit-tasks`)

Não escrito por este comando. Esperado: decomposição das 6 user stories em tarefas atômicas, ordenadas por dependência, com gate de typecheck após cada commit (regra do usuário: commit + push para `master` por feature).

## Complexity Tracking

> **Sem violações de constituição**. Esta seção fica intencionalmente vazia.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |

---

## Re-evaluation Post-Phase-1

Após geração de `data-model.md`, `contracts/tokens.schema.json`, `contracts/appointment-status-badge.contract.md`, `contracts/typography-scale.contract.md` e `quickstart.md`:

- **Constituição re-avaliada**: nenhuma nova superfície de domínio introduzida pelo design. Os "entidades-conceito" do `data-model.md` são UI (tokens, escala tipográfica, status visuais), não entidades de banco. Princípios I–V continuam **N/A** e **Pass**.
- **Sem violações novas** descobertas durante a fase de design.
- **Sem entradas em Complexity Tracking** — tabela permanece vazia.
- **Decisão de domínio adjacente registrada** em `research.md` §3: o componente cobre 7 estados visuais mas o banco hoje só persiste 3. Mapper inicial pragmático (`ativo → concluido`) será revisto quando o domínio formalizar os estados intermediários — isso **não** é trabalho de 016.

✅ **Plan final aprovado.** Pronto para `/speckit-tasks`.

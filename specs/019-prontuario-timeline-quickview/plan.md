# Implementation Plan: Prontuário Clínico unificado — Timeline + Quick-View

**Branch**: `019-prontuario-timeline-quickview` | **Date**: 2026-05-20 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/019-prontuario-timeline-quickview/spec.md`

## Summary

Reorganizar a página `/operacao/pacientes/[id]` de uma pilha vertical de ~10 cards para um layout de duas colunas: à esquerda uma **sidebar sticky** (Quick-View) com identidade, contato, plano, alergias, diagnósticos ativos/em-acompanhamento, última medição vital, resumo financeiro e ações rápidas; à direita duas abas (`?tab=`) — **"Clínico"** com uma **timeline cronológica unificada** mesclando 4 fontes de eventos (clinical_records, vital_signs, appointments_effective, payments) com chips de filtro por tipo, e **"Cadastro"** com as edições estruturadas existentes (endereço, lembretes opt-in, plano de saúde, plano terapêutico). Formulários de criação migram de panes inline para Sheets sobrepostos disparados pela sidebar. **Zero migration, zero rota nova, zero RPC nova** — só agregação client-side dos dados que `getPatient` + helpers existentes já retornam, mais 1 SELECT batch para resolver nomes de autores via `doctors`+`user_profile`.

## Technical Context

**Language/Version**: TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel)
**Primary Dependencies**: Next.js 14.2 (App Router + RSC + Server Actions), `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Tailwind CSS 3.4, shadcn/ui (Radix `Sheet`, `Dialog`, `Tabs` já presentes — confirmado em `src/components/ui/`), `date-fns` 4.1, `lucide-react`, `recharts` (já em uso por `VitalSignsSection`)
**Storage**: PostgreSQL via Supabase — **somente leitura** dos schemas existentes. Tabelas tocadas (read-only): `patients`, `appointments_effective` (view), `clinical_records`, `vital_signs`, `patient_allergies`, `patient_diagnoses`, `patient_history`, `treatment_plan_steps`, `appointments`, `payment_records`/`expenses`, `doctors`, `user_profile`, `health_plans`, `procedures`. **Sem migration nova.**
**Testing**: Vitest (suite atual). Para esta feature: testes de unidade em `lib/core/patient-timeline/` (assembleTimelineEvents + buildQuickViewSnapshot + resolveAuthors), testes de componente React via `@testing-library/react` (Quick-View renderiza blocos condicionalmente; Timeline filtra; Sheet abre/fecha com Esc). **Sem contract tests novos** (não há nova API).
**Target Platform**: Web — Next.js 14 App Router (SSR + hydration). Browsers modernos (Chrome 120+, Safari 17+, Firefox 120+).
**Project Type**: Web application (Next.js monorepo).
**Performance Goals**: SSR + first paint ≤2s em 3G boa (SC-005); scroll ≥50fps em 50+ eventos (SC-007); sheet open ≤100ms; tab switch ≤150ms.
**Constraints**: Sem schema change, sem nova rota `/api/*`, sem nova RPC, sem alteração de `lib/core/*` existente (apenas novo módulo `lib/core/patient-timeline/`). Auditoria, RBAC e anonimização LGPD preservados sem alteração. Failures card de admin preservado.
**Scale/Scope**: Volume típico por paciente <50 eventos (A-002); ≤200 carregados na primeira renderização (FR-018); 4 fontes de eventos a mesclar; 8 formulários a re-embrulhar em Sheets; 4 componentes de edição a mover para aba "Cadastro".

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Aplicabilidade | Status | Justificativa |
|---|---|---|---|
| **I. Integridade Financeira Imutável** | Leitura apenas de `payment_records`/`appointments_effective` para sidebar e timeline. Nenhum INSERT/UPDATE/DELETE financeiro. | ✅ PASS | Feature é UX-only. Append-only preservado por inércia. |
| **II. Auditabilidade Total de Preços** | Não altera tabelas auditadas. Os formulários re-embrulhados em Sheets continuam usando os mesmos endpoints `/api/pacientes/[id]/*` que já registram `log_audit_event`. | ✅ PASS | Trilha de auditoria preservada. |
| **III. Isolamento Multi-Tenant** | Todas as consultas continuam filtradas por `tenant_id` via `session.tenantId` (padrão atual). O novo SELECT batch para resolver nomes em `doctors` + `user_profile` MUST incluir `eq('tenant_id', session.tenantId)`. RLS atual cobre. | ✅ PASS | Cobertura RLS + WHERE de tenant. Documentar como teste em data-model.md. |
| **IV. Conformidade TUSS/ANS** | TUSS é lido apenas para exibição de procedimentos no histórico (já presente). Sem mudança no catálogo. | ✅ PASS | N/A direta. |
| **V. Segurança por Perfil de Acesso (RBAC)** | Botões/ações renderizam só se `can(role, …)` permite (defesa em profundidade), e endpoints continuam validando server-side. Mantém o padrão de `page.tsx:354-365`. | ✅ PASS | RBAC client-side é UX, não controle de segurança. Server-side intacto. |

**Domínio adicional**:
- **LGPD**: paciente anonimizado mantém renderização restrita (FR-026). Logs novos do client não devem conter PII (usar `user_id` truncado é OK, nome **só** se já retornado pelos endpoints com RLS).
- **Relógio UTC**: timestamps continuam UTC em persistência, formatados na UI via `formatDateTime` existente.
- **Moeda**: continuam centavos; sidebar usa `formatCurrency` existente.

**Verdict**: ✅ GATE PASSED. Zero violações; nenhum item no Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/019-prontuario-timeline-quickview/
├── plan.md              # Este arquivo
├── spec.md              # ✅ existente, já consolidada via /speckit.clarify
├── research.md          # Phase 0 (criar)
├── data-model.md        # Phase 1 (criar) — TimelineEvent, QuickViewSnapshot, AuthorMap
├── quickstart.md        # Phase 1 (criar)
├── contracts/
│   └── component-contracts.md   # Phase 1 — props/events dos componentes novos
└── checklists/
    └── requirements.md  # ✅ existente, 100% PASS
```

### Source Code (repository root)

```text
src/
├── app/(dashboard)/operacao/pacientes/[id]/
│   ├── page.tsx                                # REFATORADO: grid 2 cols + tabs ?tab=
│   ├── loading.tsx                             # mantido
│   ├── error.tsx                               # mantido
│   ├── _components/                            # NOVO diretório (escopo do refactor)
│   │   ├── patient-quick-view.tsx              # NOVO — sidebar sticky
│   │   ├── quick-view-blocks/
│   │   │   ├── identity-block.tsx              # NOVO
│   │   │   ├── contact-block.tsx               # NOVO
│   │   │   ├── plan-block.tsx                  # NOVO (envolve PatientPlanEditor)
│   │   │   ├── allergies-block.tsx             # NOVO (chips)
│   │   │   ├── diagnoses-block.tsx             # NOVO (ativo + em_acompanhamento)
│   │   │   ├── last-vital-block.tsx            # NOVO (PA, FC, peso, IMC)
│   │   │   ├── financial-block.tsx             # NOVO (recebido/pendente)
│   │   │   └── actions-block.tsx               # NOVO (botões → sheets)
│   │   ├── clinical-timeline.tsx               # NOVO — feed unificado
│   │   ├── timeline-event-item.tsx             # NOVO — item polimórfico
│   │   ├── timeline-filters.tsx                # NOVO — chips
│   │   ├── cadastro-tab.tsx                    # NOVO — agrupa edições estruturadas
│   │   ├── mobile-quick-view-header.tsx        # NOVO — header colapsável <768px
│   │   ├── mobile-action-bar.tsx               # NOVO — FAB bar
│   │   └── sheets/
│   │       ├── new-evolution-sheet.tsx         # NOVO — re-embala NewEvolutionForm
│   │       ├── new-anamnese-sheet.tsx          # NOVO
│   │       ├── new-text-sheet.tsx              # NOVO
│   │       ├── upload-file-sheet.tsx           # NOVO
│   │       ├── new-vital-sheet.tsx             # NOVO
│   │       ├── new-allergy-sheet.tsx           # NOVO
│   │       ├── new-history-sheet.tsx           # NOVO
│   │       └── new-diagnosis-sheet.tsx         # NOVO
│   ├── address-editor.tsx                      # mantido — consumido por cadastro-tab
│   ├── reminders-opt-in-toggle.tsx             # mantido — idem
│   ├── patient-plan-editor.tsx                 # mantido — idem
│   ├── treatment-steps-section.tsx             # mantido — idem
│   ├── medical-history-section.tsx             # REFAT: extrai forms para sheets; view permanece
│   ├── vital-signs-section.tsx                 # REFAT: extrai form para sheet; chart permanece em "Sinais vitais" no filtro
│   ├── diagnosticos-section.tsx                # REFAT: extrai form para sheet
│   ├── clinical-records-section.tsx            # REFAT: extrai forms para sheets; view permanece
│   ├── appointments-history-table.tsx          # mantido — exibido em timeline e/ou na sub-aba opcional
│   ├── financeiro-section.tsx                  # REUTILIZADO em cadastro-tab + items na timeline
│   ├── print-chart-button.tsx                  # mantido — agora invocado pela sidebar
│   └── cleanup-button.tsx                      # mantido
└── lib/core/patient-timeline/                  # NOVO módulo
    ├── types.ts                                # NOVO — TimelineEvent (union), QuickViewSnapshot
    ├── assemble.ts                             # NOVO — assembleTimelineEvents()
    ├── quick-view-snapshot.ts                  # NOVO — buildQuickViewSnapshot()
    ├── resolve-authors.ts                      # NOVO — batch doctors+user_profile
    └── index.ts                                # NOVO — re-exports

tests/
├── unit/lib/core/patient-timeline/
│   ├── assemble.test.ts                        # NOVO
│   ├── quick-view-snapshot.test.ts             # NOVO
│   └── resolve-authors.test.ts                 # NOVO
└── components/pacientes/                       # diretório existente
    ├── patient-quick-view.test.tsx             # NOVO
    ├── clinical-timeline.test.tsx              # NOVO
    └── sheets/                                 # NOVOS (smoke tests por sheet)
```

**Structure Decision**: Arquitetura **Next.js App Router (web app)** com colocação de UI sob `app/(dashboard)/operacao/pacientes/[id]/_components/` (convenção `_components` já adotada em `app/(dashboard)/_components/`). Lógica pura (montagem de eventos, snapshot, batch de autores) fica em `lib/core/patient-timeline/` — facilita teste unitário sem React e segue o padrão existente de `lib/core/patient-medical/`. **Nada vai em `src/components/ui/`** — esses são primitivos shadcn; componentes específicos da feature ficam no escopo da rota.

## Phase 0 — Outline & Research (já delineada)

Itens que `research.md` resolverá:

1. **shadcn `Sheet` acessibilidade**: verificar trap de foco + Esc-to-close out-of-the-box (Radix Dialog primitives).
2. **Estratégia de URL para tabs**: `searchParams` server-side (RSC re-render por mudança de tab) vs. client-side `useSearchParams` + `router.replace` (sem refetch). Decisão: client-side com shallow update (não dispara refetch). Justificar.
3. **Batch author resolution**: 1 SELECT em `doctors` + 1 SELECT em `user_profile` filtrados por `tenant_id` + `IN (...)` de user_ids únicos coletados do conjunto inicial de eventos. Cache no `Map<userId, displayName>`.
4. **Virtualização da timeline**: para ≤200 itens, render direto sem virtualização. Decisão e benchmark grosseiro documentado.
5. **Reuso do `assembleProntuarioBundle`**: avaliar se a função existente (em `lib/core/patient-medical/assemble-prontuario.ts`) já faz o agregado necessário ou se precisa de uma função paralela. Decisão: a função existente serve ao PDF (formato fixo, mais campos); criar `assembleTimelineEvents` separado mantém SRP e evita acoplamento entre feature de UI e geração de PDF.

**Output esperado**: `research.md`.

## Phase 1 — Design & Contracts (planejado)

1. **data-model.md**: tipos virtuais `TimelineEvent` (união discriminada por `kind`), `QuickViewSnapshot` (agregado de blocos da sidebar), `AuthorMap` (Map<user_id, display_name>). Nenhum modelo persistido novo. Diagrama de fontes → eventos.
2. **contracts/component-contracts.md**: props/eventos de cada componente novo. Tratado como "interface" no sentido React: o que o componente recebe (`Props`), o que dispara (`onCreated`, `onClose`), e quais invariantes preserva (ex.: "ao salvar com sucesso o componente MUST chamar `router.refresh()` antes de fechar sheet").
3. **quickstart.md**: roteiro de smoke-test manual: criar um paciente, popular cada tipo de evento, abrir a ficha, validar sidebar + timeline + filtros + sheet (Esc + click overlay) + mobile.
4. **Agent context update**: rodar `update-agent-context.ps1 -AgentType claude` para acrescentar a feature 019 no `CLAUDE.md` (linha "Active Technologies" + "Recent Changes").

## Complexity Tracking

Sem violações da constituição; Complexity Tracking vazio.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |

## Constitution Check — Re-evaluation pós-Phase 1 (2026-05-20)

| Princípio | Status após design | Notas |
|---|---|---|
| **I. Integridade Financeira Imutável** | ✅ PASS | Designs (data-model.md, contracts/) confirmam: zero INSERT/UPDATE/DELETE financeiro. Sheets reutilizam endpoints existentes que já honram append-only. |
| **II. Auditabilidade Total de Preços** | ✅ PASS | Sheets disparam endpoints existentes (`/api/pacientes/[id]/registros`, `/diagnosticos`, etc.) que já chamam `log_audit_event`. `resolveAuthors` é leitura. |
| **III. Isolamento Multi-Tenant** | ✅ PASS | `data-model.md` §7 lista checklist de tenant filtering em cada fonte. `resolveAuthors` explicita `eq('tenant_id', tenantId)` em ambos SELECTs. RLS atual cobre. |
| **IV. Conformidade TUSS/ANS** | ✅ PASS | TUSS continua leitura apenas; sem nova mutação. |
| **V. Segurança por Perfil de Acesso (RBAC)** | ✅ PASS | `permissions` no `QuickViewSnapshot` deriva de `can(role, …)` server-side. Componentes (C1 I-3, C7 I-3) honram via render condicional; endpoints continuam validando. |
| **LGPD / Anonimização** | ✅ PASS | `<PatientQuickView>` (C1 I-1), `<ClinicalTimeline>` (C2 I-4), `<CadastroTab>` (C4 I-1) todos honram `isAnonymized` com render restrito. Logs novos do client não vazam PII. |

**Verdict**: Phase 1 design não introduz nenhuma violação. Pronta para `/speckit.tasks`.

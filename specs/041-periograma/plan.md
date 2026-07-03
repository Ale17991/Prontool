# Implementation Plan: Periograma (periodontograma) odontológico — Fase 3

**Branch**: `041-periograma` | **Date**: 2026-06-23 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/041-periograma/spec.md`

## Summary

Entregar o **periograma** (periodontograma) como nova seção do hub **Odonto-Space** no prontuário. Diferente do odontograma (estado corrente por posição), o periograma é um **exame de boca toda datado**: o profissional cria um exame em **rascunho**, preenche numa grade clássica (dentes nas colunas; linhas de profundidade de sondagem, recessão e sangramento para as arcadas vestibular e lingual/palatina) as medições de **6 sítios por dente** + achados por dente (mobilidade, furca, ausente/implante), e **finaliza** — congelando o exame como snapshot histórico imutável. Indicadores (% sangramento, bolsas ≥4 mm, CAL médio) são calculados na leitura; a tela permite **comparar dois exames** ao longo do tempo.

Abordagem técnica: reusar integralmente os padrões do módulo odonto. Migration `0161_perio_chart.sql` com RLS por tenant, triggers de auditoria (`log_audit_event`) e de congelamento ao finalizar (espelhando `treatment_budgets` da 0160). Reuso de `src/lib/core/dental/teeth.ts` (FDI, dentição). Core em `src/lib/core/dental/perio/`, rotas `requireRole` + `createSupabaseServiceClient`, nova seção em `odonto-space.tsx`. **Sem novas deps** — grade renderizada com tabela/HTML + React. CAL = profundidade + recessão (recessão com sinal). Estadiamento/grau AAP 2017, PDF e 4-sítios ficam fora desta versão.

## Technical Context

**Language/Version**: TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel)
**Primary Dependencies**: Next.js 14.2 (App Router, RSC, Route Handlers), `@supabase/ssr` 0.5 / `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind CSS 3.4, shadcn/ui (Radix), `lucide-react`. **Sem novas deps** — grade do periograma em tabela HTML/React; comparação reusa `recharts` (já presente) apenas se houver gráfico de evolução (opcional).
**Storage**: PostgreSQL via Supabase (local: `supabase start` :54321) com RLS por `tenant_id`. **Migration nova**: `0161_perio_chart.sql`. **Tabelas novas**: `perio_exams` (cabeçalho do exame, ciclo rascunho→finalizado), `perio_site_measurements` (6 sítios/dente), `perio_tooth_findings` (mobilidade/furca/ausente/implante). **Tabelas tocadas (uso)**: `patients`, `appointments` (FK opcional + consistência tenant), `audit_log` (via `log_audit_event`). **RPC nova**: `perio_exam_indicators(p_tenant_id, p_exam_id)` (DEFINER) — indicadores agregados.
**Testing**: Vitest (`pnpm test`, `pnpm test:integration`, `pnpm test:contract`), `pnpm lint:auth`, `pnpm supabase:reset`
**Target Platform**: Web app SSR (Vercel) + navegadores modernos
**Project Type**: Web application (Next.js App Router monorepo single-app)
**Performance Goals**: Entrada de dados fluida — edição de um sítio percebida como instantânea (atualização otimista no cliente, persistência debounced/em lote). Abertura de um exame e cálculo de indicadores sem percepção de espera.
**Constraints**: Exame finalizado é imutável (trigger de congelamento). Isolamento estrito por tenant. No máximo um rascunho por paciente. Faixas: profundidade 0–15 mm; recessão −5 a +15 mm. RBAC: escrita só admin/profissional_saude. Sem novas deps de runtime.
**Scale/Scope**: até 32 dentes permanentes × 6 sítios = 192 medições/exame (+ 20 decíduos quando aplicável); achados por dente até 52 linhas. Histórico de exames por paciente é modesto. ~1 migration, 3 tabelas + 1 RPC, ~7 arquivos core, ~5 rotas, 1 seção de UI (grade + comparação).

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

- **I. Integridade Financeira Imutável (NON-NEGOTIABLE)**: Sem valores financeiros nesta feature. Princípio aplicado por analogia: o exame **finalizado** é imutável (trigger congela `perio_exams` + bloqueia escrita nas medições/achados quando o exame não está em rascunho — padrão de `treatment_budgets`, 0160). Correção = novo exame. ✅ PASS
- **II. Auditabilidade Total (NON-NEGOTIABLE)**: Criação e finalização do exame disparam `log_audit_event` (ator, tenant, entidade, transição de estado). ✅ PASS
- **III. Isolamento Multi-Tenant**: As três tabelas carregam `tenant_id` obrigatório, RLS `tenant_id = jwt_tenant_id()`, triggers de consistência paciente↔tenant e atendimento↔tenant; medições/achados herdam o tenant do exame (validado em trigger). ✅ PASS
- **IV. Conformidade TUSS/ANS**: Periograma é registro clínico, não cobrança — não emite código TUSS. Procedimentos periodontais derivados (raspagem etc.) entram pelo plano de tratamento (Fase 2), fora do escopo. Sem violação. ✅ PASS
- **V. Segurança por Perfil (RBAC)**: Criação/edição/finalização restritas server-side a `admin` + `profissional_saude` (`requireRole`); leitura para os papéis clínicos/administrativos do tenant. Controle no servidor, não só UI. ✅ PASS

**Resultado**: Sem violações. Complexity Tracking vazio.

## Project Structure

### Documentation (this feature)

```text
specs/041-periograma/
├── plan.md              # Este arquivo
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/           # Phase 1 (REST + RPC)
│   └── periograma-api.md
├── checklists/
│   └── requirements.md  # Spec quality checklist (já criado)
└── tasks.md             # Phase 2 (/speckit.tasks — NÃO criado aqui)
```

### Source Code (repository root)

```text
supabase/migrations/
└── 0161_perio_chart.sql         # 3 tabelas + RLS + triggers (consistência, congelamento, auditoria) + RPC indicadores

src/lib/core/dental/
├── teeth.ts                     # (reuso) FDI permanente/decíduo, dentição — sem mudança
└── perio/
    ├── sites.ts                 # constantes dos 6 sítios + faixas plausíveis + cálculo de CAL/indicadores (puro)
    ├── create-exam.ts           # cria exame em rascunho (rejeita 2º rascunho)
    ├── save-measurements.ts     # upsert de medições/achados (só em rascunho)
    ├── finalize-exam.ts         # finaliza (congela) o exame
    ├── discard-exam.ts          # descarta rascunho
    ├── list-exams.ts            # lista exames do paciente (com indicadores resumidos)
    ├── get-exam.ts              # exame completo (medições + achados + indicadores)
    └── compare-exams.ts         # comparação por sítio + deltas de indicadores entre dois exames

src/app/api/pacientes/[id]/periograma/
├── route.ts                     # GET (lista exames) / POST (cria rascunho)
├── comparar/route.ts            # GET (compara dois exames: ?from=&to=)
└── [examId]/
    ├── route.ts                 # GET (exame completo) / PATCH (salvar medições/achados) / DELETE (descartar rascunho)
    └── finalizar/route.ts       # POST (finaliza)

src/app/(dashboard)/operacao/pacientes/[id]/_components/
├── odontogram/odonto-space.tsx  # (editar) acrescenta seção "Periograma"
└── perio/
    ├── perio-tab.tsx            # orquestra: lista exames, abre/cria, alterna entre exame e comparação
    ├── perio-chart-grid.tsx     # grade clássica de entrada (dentes×sítios, navegação por teclado)
    ├── perio-indicators.tsx     # painel de % BOP, bolsas ≥4mm, CAL médio
    └── perio-compare.tsx        # comparação entre duas datas

tests/
├── contract/perio-exam-immutability.test.ts   # congelamento ao finalizar + único rascunho
├── integration/perio-tenant-isolation.test.ts
├── integration/perio-rbac.test.ts
└── unit/perio-calc.test.ts                     # CAL e indicadores (sites.ts puro)
```

**Structure Decision**: Web application Next.js single-app. O periograma segue exatamente o layout do módulo odonto: migration única idempotente, core puro em `src/lib/core/dental/perio/`, rotas finas com `requireRole` + service client, e UI como sub-seção do `odonto-space.tsx`. O cálculo de CAL/indicadores fica num módulo puro (`sites.ts`) para ser testável sem banco e reaproveitado por RPC/serviço/UI.

## Complexity Tracking

> Sem violações de constituição — seção vazia.

# Implementation Plan: Avaliação Nutricional

**Branch**: `046-avaliacao-nutricional` | **Date**: 2026-07-16 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/046-avaliacao-nutricional/spec.md`

## Summary

Tela própria de **Avaliação Nutricional** (gated por `hasModule('nutri_avaliacao')`) onde o profissional registra medidas de um paciente e o sistema calcula **composição corporal** (dobras → densidade → %gordura por Siri; massa gorda/magra; IMC e RCQ com classificação) e **necessidades energéticas** (TMB por equação → GET com fator de atividade/injúria/gestação → VET-meta → macros). Cada avaliação é um **snapshot imutável** (`nutrition_assessments`) que **alimenta o motor de medições longitudinais** (feature 030), reaproveitando gráficos, metas e portal do paciente.

Abordagem técnica: **motor de cálculo TS puro** (`src/lib/core/nutrition/`) replicando 1:1 as equações das planilhas de referência (ver `nutri-doc/formulas-referencia.md`, com coeficientes canônicos onde a planilha divergia); persistência via migration nova `0175` + RPC `SECURITY DEFINER`; derivados gravados com `recordMeasurementsBatch` já existente; UI em rota nova. **Sem novas dependências.**

## Technical Context

**Language/Version**: TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel)
**Primary Dependencies**: Next.js 14.2 (App Router, RSC, Server Actions, Route Handlers), `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind 3.4, shadcn/ui (Radix), `recharts` (gráficos de evolução já em uso). **Sem novas deps** — o motor de cálculo é TS puro (sem libs de estatística/nutrição).
**Storage**: PostgreSQL via Supabase (local: `supabase start` :54321) com RLS por `tenant_id`. **Migration nova**: `0175_nutrition_assessments.sql`. Reuso: `patient_measurements`, `patient_metric_types` (+1 métrica), `patient_metric_goals`, `patients`, `vital_signs`.
**Testing**: vitest — `tests/unit` (cada equação/protocolo vs gabarito), `tests/integration` (salvar → snapshot + derivados nas medições), `tests/contract` (imutabilidade, isolamento de tenant, RBAC).
**Target Platform**: Vercel serverless (Node) + Supabase Postgres.
**Project Type**: Web app (Next.js monolito com App Router).
**Performance Goals**: cálculo é síncrono e local (instantâneo, sem I/O); "resultado ao vivo" recalcula no cliente. Sem metas de throughput especiais.
**Constraints**: append-only (avaliação imutável, correção = nova), RLS por tenant, RBAC server-side, auditoria em toda criação; valores numéricos validados por faixa plausível.
**Scale/Scope**: por clínica, baixo volume (avaliações pontuais por paciente); 1 tela + 1 tabela + motor de cálculo (~16 equações + ~10 protocolos).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Integridade/Imutabilidade** — ✅ `nutrition_assessments` é **append-only** (trigger anti-UPDATE/DELETE); correção = nova avaliação (FR-014, FR-017). Não há dado financeiro nesta feature.
- **II. Auditabilidade** — ✅ criação de avaliação auditada via `log_audit_event` (ator, timestamp, tenant, entidade) — FR-020.
- **III. Isolamento Multi-Tenant** — ✅ `tenant_id` obrigatório + RLS por `jwt_tenant_id()`; teste de contrato de isolamento (FR-003, SC-006). PKs UUID.
- **IV. Conformidade TUSS/ANS** — ➖ **N/A**: avaliação nutricional não usa códigos TUSS nem integra operadora.
- **V. RBAC** — ✅ `requireRole(['admin','profissional_saude'])` server-side na rota + policy de INSERT; gate de módulo `nutri_avaliacao`; negações logadas (FR-002).
- **LGPD** — ✅ reusa o paciente já cifrado; os derivados entram no motor de medições existente (mesmo tratamento). Sem novo PII em claro.
- **Moeda/UTC** — ➖ sem valores monetários; timestamps em UTC (padrão do projeto).

**Resultado**: sem violações. "Complexity Tracking" vazio.

## Project Structure

### Documentation (this feature)

```text
specs/046-avaliacao-nutricional/
├── plan.md              # Este arquivo
├── research.md          # Fase 0 (decisões resolvidas)
├── data-model.md        # Fase 1 (schema nutrition_assessments + métrica nova)
├── quickstart.md        # Fase 1 (roteiro de validação)
├── contracts/           # Fase 1 (rotas da API)
└── tasks.md             # Fase 2 (/speckit.tasks — NÃO criado aqui)
```

### Source Code (repository root)

```text
src/lib/core/nutrition/
├── energy.ts               # TMB por equação, PAL, injúria/gestante → GET, VET-meta, macros
├── body-composition.ts     # dobras → densidade → %gordura (Siri); massa gorda/magra; IMC; RCQ
├── protocols.ts            # metadados: dobras exigidas, faixa etária/sexo por protocolo/equação
├── classify.ts             # classificação IMC (OMS/idoso) e RCQ (risco por sexo)
├── age-sex.ts              # idade a partir de nascimento; guardas de faixa/sexo
├── index.ts                # barrel
└── assessments/
    ├── create.ts           # entradas → motor → grava snapshot + lança derivados nas medições
    ├── list.ts             # histórico por paciente
    └── get.ts              # detalhe

src/app/api/pacientes/[id]/avaliacao-nutricional/
├── route.ts                # POST (criar) + GET (listar) — requireRole + gate de módulo

src/app/(dashboard)/operacao/avaliacao-nutricional/
├── page.tsx                # tela própria (seleção de paciente → formulário → resultado → histórico)
└── _components/*.tsx       # formulário, painel de resultado, lista de avaliações

supabase/migrations/
└── 0175_nutrition_assessments.sql   # tabela + RLS + append-only + audit + métrica gasto_energetico_total

tests/
├── unit/nutrition-*.spec.ts         # equações e protocolos vs gabarito
├── integration/nutrition-assessment-*.spec.ts
└── contract/nutrition-assessment-*.spec.ts
```

**Structure Decision**: monolito Next.js existente. Motor de cálculo isolado em `src/lib/core/nutrition/` (TS puro, isomórfico — reusado no cliente para o "resultado ao vivo" e no servidor ao salvar). Domínio de persistência em `nutrition/assessments/`. Rota sob `/api/pacientes/[id]/...` (avaliação pertence ao paciente) e UI como tela própria em `/operacao/avaliacao-nutricional` (decisão do usuário: tela no menu, não aba). Padrões reusados: `recordMeasurementsBatch` (feature bioimpedância), `patient_metric_types`/`patient_metric_goals` (feature 030), `requireRole`, RPC `SECURITY DEFINER` + trigger append-only (perio/odonto), `log_audit_event`.

## Complexity Tracking

> Sem violações de constituição — seção não aplicável.

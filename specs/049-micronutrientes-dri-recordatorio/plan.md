# Implementation Plan: Micronutrientes, DRIs, Análise de Adequação e Recordatório (R24h)

**Branch**: `049-micronutrientes-dri-recordatorio` | **Date**: 2026-07-27 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/049-micronutrientes-dri-recordatorio/spec.md`

## Summary

Completar a vertical de nutrição com paridade às planilhas base: (1) micronutrientes na base de alimentos (JSONB), importados da `BD ALIMENTOS` da AF; (2) catálogo global de DRIs (recomendação por idade/sexo/estado) da `BD_DRIs`; (3) motor de análise de adequação (plano/recordatório × DRI, % e classificação abaixo/adequado/acima); (4) tela de recordatório alimentar R24h gated por `nutri_recordatorio`. Tudo em TS puro (aritmética), reusando ao máximo o motor de soma (047), a busca de alimentos, medidas caseiras e o seletor de paciente. Faseado: micros → DRIs+adequação → recordatório.

## Technical Context

**Language/Version**: TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel)
**Primary Dependencies**: Next.js 14.2 (App Router, RSC, Server Actions, Route Handlers), `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind 3.4, shadcn/ui (Radix), `recharts` (gráficos, já em uso), `lucide-react`. **Sem novas dependências** — cálculo é aritmética simples (regra de três + comparação com faixa).
**Storage**: PostgreSQL via Supabase (local: `supabase start` :54321) com RLS por `tenant_id`. **Migrations novas** (próximo número livre após 0180): `micronutrients JSONB` em `foods`; tabela global `dietary_reference_intakes`; tabelas `food_recalls` + `food_recall_items`. **Seed**: micros importados da `BD ALIMENTOS` (AF, 6570 alimentos) como base global; DRIs da `BD_DRIs` (Evonut). Gabarito = planilhas em `nutri-doc/`.
**Testing**: Vitest (unit + integration + contract). Motor de soma/adequação com testes unitários (números batendo, SC-002/SC-003); rotas com contract/RBAC; integração para recordatório e importação.
**Target Platform**: Web (dashboard SSR + telas client para cálculo ao vivo) + rotas API.
**Project Type**: Web application (Next.js App Router monorepo único em `src/`).
**Performance Goals**: cálculo ao vivo imperceptível (<16 ms por recomputação de totais/adequação no cliente); busca de alimentos já existente (RPC trigram). Importação da base AF é offline (script), não no request path.
**Constraints**: motor isomórfico cliente/servidor (mesma função soma tela e grava — SC-002); micros opcionais/esparsos (ausência ≠ zero, sinalizada); multi-tenant RLS; catálogos globais `tenant_id IS NULL`.
**Scale/Scope**: base global ~+6570 alimentos com micros; ~37 micronutrientes; DRIs por faixa etária × sexo × estado; recordatórios por paciente (volume baixo por clínica). 3 histórias, faseadas.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

- **I. Integridade Financeira Imutável**: N/A direto (feature não cria registros financeiros). A prescrição imutável do plano (047) já existe e não é tocada. Recordatório é registro clínico editável (não financeiro) — sem violação.
- **II. Auditabilidade Total**: escrita de alimento próprio (com micros), recordatório e qualquer edição usam `log_audit_event` no padrão existente. DRIs são catálogo global read-only pela clínica.
- **III. Isolamento Multi-Tenant**: `food_recalls`/`food_recall_items` carregam `tenant_id` + RLS; alimentos próprios já isolados; base global e DRIs são `tenant_id IS NULL` (leitura por todos). Contract test de isolamento no recordatório e nos alimentos próprios.
- **IV. Conformidade TUSS/ANS**: N/A (domínio nutricional, não TUSS).
- **V. RBAC**: leitura/escrita de recordatório e alimentos próprios restritas a `admin`/`profissional_saude`; recordatório gated pelo módulo `nutri_recordatorio`. Contract/RBAC test por papel. Autorização server-side (`requireRole`).

**Resultado**: PASS — sem violações. Nenhuma entrada em Complexity Tracking necessária.

## Project Structure

### Documentation (this feature)

```text
specs/049-micronutrientes-dri-recordatorio/
├── plan.md              # Este arquivo
├── research.md          # Decisões técnicas (Phase 0)
├── data-model.md        # Entidades/migrations (Phase 1)
├── quickstart.md        # Roteiro de validação manual (Phase 1)
├── contracts/           # Contratos de API (Phase 1)
│   └── api.md
└── tasks.md             # (/speckit.tasks — não criado aqui)
```

### Source Code (repository root)

```text
src/
├── lib/core/nutrition/
│   ├── micronutrients.ts            # NOVO: catálogo dos ~37 micros (key, label, unidade)
│   ├── diet/totals.ts               # ESTENDER: soma inclui micros (regra de três)
│   ├── adequacy.ts                  # NOVO: motor de adequação (totais × DRI → % + classe)
│   ├── dri/                         # NOVO: leitura da tabela de DRIs (lookup por idade/sexo/estado)
│   │   └── read.ts
│   ├── foods/{search,custom}.ts     # ESTENDER: DTO/insert de alimento carrega micros
│   └── recall/                      # NOVO: domínio do recordatório (save/list/get + totais)
│       └── plan.ts
├── app/(dashboard)/operacao/
│   ├── recordatorio/                # NOVO: tela do recordatório (page + client, gated nutri_recordatorio)
│   └── plano-alimentar/…            # ESTENDER: painel de adequação no plano (opcional na US2)
├── app/(dashboard)/configuracoes/alimentos/…   # ESTENDER: cadastro/visualização de micros
├── app/api/pacientes/[id]/
│   ├── recordatorio/route.ts        # NOVO: GET/POST recordatório
│   └── adequacao/route.ts           # NOVO: GET análise de adequação (plano ou recordatório)
└── app/api/alimentos/…              # ESTENDER: busca retorna micros

supabase/migrations/                 # micros em foods; dietary_reference_intakes; food_recalls(+items)
scripts/                             # importador da BD ALIMENTOS (micros) + seed DRIs
tests/{unit,integration,contract}/   # motor de micros/adequação; recordatório; RBAC/isolamento
```

**Structure Decision**: projeto único Next.js (`src/`), seguindo o layout já usado por 046/047 — domínio puro em `src/lib/core/nutrition/`, rotas em `src/app/api/`, telas em `src/app/(dashboard)/`. Nenhuma estrutura nova de projeto.

## Complexity Tracking

> Sem violações de constituição — nenhuma justificativa necessária.

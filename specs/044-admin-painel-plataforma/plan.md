# Implementation Plan: Painel /admin — financeiro, uso, auditoria e saúde do sistema

**Branch**: `044-admin-painel-plataforma` | **Date**: 2026-06-26 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/044-admin-painel-plataforma/spec.md`

## Summary

Quatro painéis somente-leitura no `/admin` (super-admin), reusando dados existentes:

1. **Financeiro/MRR** — preço por plano em config editável nova (`plan_prices`), MRR total e por plano, contagens por status de cobrança, trials a vencer, inadimplentes, churn.
2. **Saúde & uso das clínicas** — atendimentos no período, usuários ativos, última atividade, sinal de risco (inativa > 14 dias).
3. **Auditoria global** — feed cross-tenant de `audit_log` das ações sensíveis, com filtros.
4. **Saúde do sistema** — alertas, integrações falhando, DLQ, status de lembretes/crons.

Única escrita da feature: editar os preços de plano (super-admin, auditado). Todo o resto é agregação de leitura.

## Technical Context

**Language/Version**: TypeScript 5.4 / Node.js 20 LTS (runtime Vercel)
**Primary Dependencies**: Next.js 14.2 (App Router, RSC, Server Actions), `@supabase/ssr` 0.5 / `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind 3.4, shadcn/ui, `recharts` (já em uso, p/ gráficos opcionais), `date-fns`. **Sem novas deps.**
**Storage**: PostgreSQL via Supabase. **Migration nova**: `0165_plan_prices.sql`. **Tabela nova**: `plan_prices` (global, sem tenant_id — preço por plano, em centavos). **Tabelas LIDAS (cross-tenant, service client)**: `tenant_entitlements` (plan/status/trial_ends_at), `tenants`, `user_tenants`, `appointments`, `audit_log`, `alerts`, `integration_sync_log`, `appointment_reminders`. `audit_log` (uso na edição de preço).
**Testing**: vitest — unit (cálculo de MRR: soma plano×preço; flag de risco por inatividade; mapeamento de eventos sensíveis no feed). Integration leve onde fizer sentido.
**Target Platform**: Web app SSR (Vercel) + Supabase.
**Project Type**: Web application (Next.js App Router single-package).
**Performance Goals**: agregações com `count`/`head` e janelas de tempo limitadas; cada card degrada isolado (FR-003). Sob ~3s em volume normal (SC-007).
**Constraints**: super-admin server-side; leitura cross-tenant legítima (padrão /admin); valores em centavos (BRL).
**Scale/Scope**: 1 tabela nova, 1 migration, 4 painéis (páginas) + nav, ~6–8 funções de agregação, 1 action de editar preço.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

- **I. Integridade Financeira Imutável** — ✅ `plan_prices` é **config de cobrança da plataforma** (mensalidade SaaS), NÃO uma tabela de preço ligada a atendimento/fatura. Não há vínculo com registros financeiros históricos, então o versionamento `valid_from/valid_to` do Princípio I (que protege preços aplicados a atendimentos) não se aplica. Mudança de preço é auditada (Princípio II). MRR é um agregado de dashboard, não um registro financeiro persistido. _(Se no futuro quiser MRR histórico exato, versionar plan_prices é um follow-up.)_
- **II. Auditabilidade de Preços** — ✅ Editar preço de plano grava `audit_log` (ator/antes/depois/motivo). Os 4 painéis são leitura.
- **III. Isolamento Multi-Tenant** — ✅ Agregações cross-tenant são leituras LEGÍTIMAS do super-admin (já é o padrão do /admin via service client). `plan_prices` é global (config de plataforma, sem tenant_id). Nada exposto a não-super-admins.
- **IV. Conformidade TUSS/ANS** — ✅ N/A.
- **V. RBAC server-side** — ✅ Acesso restrito ao super-admin, validado no servidor (layout/guards do /admin). UI não é o mecanismo.

**Resultado**: PASS. Sem violações. Única nota: `plan_prices` é config de plataforma (não preço de atendimento), fora do escopo de versionamento do Princípio I.

## Project Structure

### Documentation (this feature)

```text
specs/044-admin-painel-plataforma/
├── plan.md            # Este arquivo
├── spec.md            # Especificação (+ Clarifications)
├── research.md        # Phase 0 — decisões/fontes de dados
├── data-model.md      # Phase 1 — plan_prices + agregações derivadas
├── quickstart.md      # Phase 1 — cenários de verificação
├── contracts/
│   └── admin-panels.md # Contrato dos agregados + action de preço
└── checklists/requirements.md
```

### Source Code (repository root)

```text
src/app/admin/
├── (layout já gateia super-admin)
├── financeiro/page.tsx          # US1 — MRR, status, trials, inadimplentes, churn
├── financeiro/plan-prices-form.tsx  # editar preços (action)
├── clinicas/  (uso pode entrar como aba/coluna ou página própria)
├── uso/page.tsx                 # US2 — uso & risco por clínica
├── auditoria/page.tsx           # US3 — feed global filtrável
├── sistema/page.tsx             # US4 — alertas/integrações/DLQ/lembretes
└── admin-nav.tsx                # + itens Financeiro, Uso, Auditoria, Sistema

src/lib/core/admin/ (novo)
├── financial-summary.ts         # MRR (plano×preço), contagens por status, trials, churn
├── plan-prices.ts               # get/set preços (set audita, super-admin)
├── clinic-usage.ts              # atendimentos/usuários ativos/última atividade/risco
├── audit-feed.ts                # query audit_log cross-tenant + filtros + paginação
└── system-health.ts             # alertas/integração/DLQ/lembretes consolidados

src/app/admin/actions.ts (ou financeiro/actions) — adminSetPlanPriceAction (super-admin, audita)

supabase/migrations/
└── 0165_plan_prices.sql

tests/unit/ (MRR, risco, mapeamento de eventos)
```

**Structure Decision**: App Next.js single-package. Cada painel é uma página sob `/admin/` (o layout do /admin já garante super-admin). A lógica de agregação fica em `src/lib/core/admin/` (testável, server-only, service client). Reuso máximo de dados existentes; só `plan_prices` é novo.

## Complexity Tracking

> Sem violações que exijam justificativa. Notas:

| Item                                   | Decisão                                                                                                                                  |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `plan_prices` mutável (não versionado) | Config de plataforma, não preço de atendimento — fora do Princípio I. Mudança auditada. Versionar = follow-up se quiserem MRR histórico. |
| Agregações potencialmente pesadas      | `count`/`head`, janelas de tempo, degradação por card (FR-003). Otimização fina é tarefa de implementação.                               |

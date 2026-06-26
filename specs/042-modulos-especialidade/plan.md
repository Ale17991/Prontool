# Implementation Plan: Módulos de Especialidade (Convênio, Odontologia, Oftalmologia)

**Branch**: `042-modulos-especialidade` | **Date**: 2026-06-25 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/042-modulos-especialidade/spec.md`

## Summary

Amarrar áreas/dados de nicho a **módulos de especialidade** no sistema de entitlements existente, de modo que cada área só apareça quando o módulo da clínica estiver ativo. Concretamente: (1) transformar o módulo `tiss` em `convenio` (TISS vira parte do convênio); (2) criar `odonto` e `oftalmo`; (3) gatear as respectivas áreas na UI seguindo o padrão já usado por `endocrino` (entitlement lido no servidor → flag passada aos componentes); (4) migração idempotente que renomeia `tiss`→`convenio` e auto-ativa cada módulo para tenants com **uso real**, preservando clínicas legacy (que recebem todos os módulos).

## Technical Context

**Language/Version**: TypeScript 5.4 / Node.js 20 LTS (runtime Vercel)
**Primary Dependencies**: Next.js 14.2 (App Router, RSC, Server Actions), React 18.3, `@supabase/ssr` 0.5 / `@supabase/supabase-js` 2.45, Tailwind 3.4, shadcn/ui. **Sem novas deps.**
**Storage**: PostgreSQL via Supabase. Tabela tocada: `tenant_entitlements` (coluna `modules TEXT[]`, só dados — sem mudança de schema). Migração nova: `0162_specialty_modules.sql`. Tabelas LIDAS para o sinal de uso (read-only): `appointment_procedures` (plan_id), `tenant_tiss_operator_config`, `tiss_guias`, `dental_chart_entries`, `perio_exams`, `ophthalmology_exams`.
**Testing**: vitest — unit (catálogo de módulos, sidebar `getVisibleSections`, hub cards `getVisibleHubCards`, `getTenantEntitlements`) + integration (migração de auto-ativação contra o stack local).
**Target Platform**: Web app SSR (Vercel) + Supabase.
**Project Type**: Web application (Next.js App Router monorepo single-package).
**Performance Goals**: Sem impacto perceptível — gating é checagem em memória sobre o entitlement já lido por request; migração é one-shot.
**Constraints**: Fail-open em erro/ausência de entitlement (mantém postura defensiva atual); migração idempotente e não-destrutiva; legacy intacto.
**Scale/Scope**: ~3 módulos, ~7 pontos de gating na UI, 1 migração de dados. Sem nova tabela, sem nova rota.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Integridade Financeira Imutável** — ✅ Não toca registros financeiros. A migração altera apenas `tenant_entitlements.modules` (configuração mutável, não histórico financeiro). Nenhum `UPDATE/DELETE` em preço/fatura/atendimento.
- **II. Auditabilidade de Preços** — ✅ Não altera preço/procedimento/convênio. As mudanças de módulo via `/admin` continuam usando o caminho existente (`set_tenant_entitlement`); a migração de backfill é registrada como migração versionada.
- **III. Isolamento Multi-Tenant** — ✅ Todo gating deriva do entitlement lido por `tenant_id`; a migração opera por tenant. Nenhuma leitura cross-tenant nova.
- **IV. Conformidade TUSS/ANS** — ✅ Não altera catálogo TUSS nem schema TISS; TISS continua íntegro, apenas sua UI é gateada por `convenio`.
- **V. RBAC server-side** — ⚠️ Esclarecimento (não é violação): o gating por módulo é uma camada de **visibilidade/entitlement comercial**, NÃO um controle de autorização. O RBAC server-side (`requireRole`/`can`) permanece inalterado em todas as rotas. Esconder uma área só afeta dados do **próprio tenant** que o papel já pode ver — não há escalonamento de privilégio nem vazamento cross-tenant. Acesso direto por URL a uma área de módulo desligado degrada para estado padrão; bloqueio de entitlement em nível de API é follow-up explícito (ver Complexity Tracking), não requisito de segurança.

**Resultado**: PASS. A única observação (Princípio V) é um esclarecimento de escopo documentado, sem violação — nenhuma entrada obrigatória de Complexity Tracking além da nota de follow-up.

## Project Structure

### Documentation (this feature)

```text
specs/042-modulos-especialidade/
├── plan.md              # Este arquivo
├── spec.md              # Especificação
├── research.md          # Phase 0 — decisões técnicas
├── data-model.md        # Phase 1 — catálogo de módulos + sinais de migração
├── quickstart.md        # Phase 1 — como verificar
├── contracts/
│   └── modules.md       # Contrato do catálogo de módulos + gating points + SQL de migração
└── checklists/
    └── requirements.md  # Checklist de qualidade da spec
```

### Source Code (repository root)

```text
src/lib/core/entitlements/
├── plans.ts                       # ModuleId/ALL_MODULES: -tiss +convenio +odonto +oftalmo
└── read.ts                        # filtra por ALL_MODULES (sem mudança de lógica)

src/app/(dashboard)/_components/
└── sidebar-sections.ts            # gate: Faturamento TISS + Recebíveis Convênio → convenio

src/app/(dashboard)/configuracoes/
└── _cards.ts                      # gate: card "Convênios" + (modelos-laudo) → convenio / oftalmo

src/app/(dashboard)/operacao/pacientes/[id]/
├── page.tsx                       # computa hasConvenio/hasOdonto/hasOftalmo e passa adiante
├── _components/patient-detail-layout.tsx   # gate aba Odonto-Space (odonto)
├── _components/cadastro-tab.tsx            # gate seção oftalmo + campo convênio do paciente
└── ophthal-exam-section.tsx                # render condicionado a oftalmo

src/app/(dashboard)/operacao/atendimentos/
└── novo/new-appointment-form.tsx + _components/add-procedure-section.tsx  # gate seletor convênio×particular

src/app/admin/clinicas/[id]/
└── clinic-detail.tsx              # MODULE_LABEL: -tiss +Convênio/Odontologia/Oftalmologia

supabase/migrations/
└── 0162_specialty_modules.sql     # rename tiss→convenio + auto-ativação por uso real

tests/
├── unit/dashboard-shell-sections.spec.ts  # atualizar matriz de visibilidade
├── unit/ (novos) entitlements/hub-cards    # gating convenio/odonto/oftalmo
└── integration/ (novo) migração 0162
```

**Structure Decision**: App Next.js single-package (padrão do projeto). O gating segue o padrão `endocrino`: o entitlement é lido no Server Component via `getTenantEntitlements(tenantId)` e o resultado (`hasModule(...)`) é passado como prop booleana para os componentes client, que escondem a área. Nenhuma estrutura nova é introduzida.

## Complexity Tracking

> Sem violações constitucionais que exijam justificativa. Um item de follow-up consciente (não bloqueante):

| Item | Decisão | Follow-up |
|------|---------|-----------|
| Enforcement de entitlement em nível de API/DB | Fora de escopo nesta fase (spec: foco é esconder na UI) | Defesa em profundidade (retornar 404/403 nas rotas de módulo desligado) fica como feature futura; sem risco de segurança porque RBAC e isolamento por tenant permanecem ativos. |

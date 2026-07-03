# Implementation Plan: Multi-Tenant Lifecycle, GHL 1:1 Binding e Filtros do Calendário

**Branch**: `010-multi-tenant-ghl-calendar` | **Date**: 2026-05-08 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/010-multi-tenant-ghl-calendar/spec.md`

## Summary

Quatro user stories estendendo o ciclo de vida de tenants e a UX de duas telas críticas:

1. **US1 (P1) — GHL 1:1 binding**: a constraint de banco já existe (migration 0062 criou `tenant_integrations.location_id` GENERATED + `UNIQUE INDEX` parcial em `(location_id) WHERE provider='ghl' AND enabled=true`), e o PK `(tenant_id, provider)` impede mais de uma linha GHL por tenant. **O gap é puramente em aplicação**: pre-flight checks em `connectGhlTenant`, no callback OAuth e no webhook de install para que o sistema responda com mensagem específica (FR-004) antes do upsert disparar erro genérico do banco. Adiciona linha de audit em rejeição (FR-008).
2. **US2 (P2) — Signup + onboarding**: nova rota pública `/registrar` (form + `supabase.auth.signUp`), nova rota `/onboarding` (form de "criar minha clínica" + RPC atômica `create_first_tenant`), middleware redireciona usuários autenticados sem clínica para `/onboarding`. Tenant criado pelo onboarding usa o nome digitado como display name e gera slug único (com sufixo numérico em colisão).
3. **US3 (P3) — Tenant selector + switch + sidebar tenant name**: nova página `/selecionar-clinica` (lista visual de tenants), nova rota `POST /api/auth/switch-tenant` que faz `auth.admin.updateUserById(uid, { user_metadata: { active_tenant_id } })` + `supabase.auth.refreshSession()` para regerar o JWT com o novo claim. Persistência de "última clínica" em nova tabela `user_active_tenant` (1:1 com `auth.users`). Sidebar do `dashboard-shell` mostra `tenants.name` no topo (com logo) e botão "Trocar clínica" no rodapé (visível para usuários multi-tenant).
4. **US4 (P4) — Calendário avançado**: refactor da página `/operacao/atendimentos` para acrescentar mini-calendário lateral, seleção de período por clique, atalhos rápidos, filtros combinados (status/procedimento/paciente/período/profissional), Mês como visualização de 1ª classe, e persistência completa de estado em query string. **Sem mudanças de backend** — endpoints existentes já aceitam ou aceitarão filtros opcionais.

Cross-cutting (FR-038): `auth_hook_custom_claims` ganha uma leitura adicional — ordem `user_metadata.active_tenant_id` → `user_active_tenant.tenant_id` → primeiro tenant ativo. Sem nenhum tenant ativo, o JWT sai sem claims, o middleware vê `tenantId == null` e redireciona para `/onboarding`.

## Technical Context

**Language/Version**: TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel).
**Primary Dependencies**: Next.js 14.2 (App Router), `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind 3.4, shadcn/ui (Radix), `date-fns` 4.1, `lucide-react`. **Sem novas deps de runtime**. Para o calendário usamos `date-fns` (já em deps) — para semana/mês/range; mini-calendário é componente próprio (não há libs no projeto que façam render de mês compacto, e adicionar uma só para isso é overkill).
**Storage**: PostgreSQL via Supabase (local `supabase start` :54321). **Migration nova**: `0065_active_tenant_and_signup.sql`. **Tabelas tocadas**: nenhuma alteração de schema em `tenants`, `tenant_integrations` ou `user_tenants` (todos os FRs se apoiam nas estruturas existentes). **Tabela nova**: `user_active_tenant` (1:1 com `auth.users`, persiste última clínica usada). **Função nova**: `create_first_tenant(p_user_id, p_name, p_slug, p_cnpj, p_phone)` SECURITY DEFINER — atomicidade da criação onboarding (insert tenants + insert user_tenants admin + insert user_active_tenant). **Função alterada**: `auth_hook_custom_claims` recebe nova prioridade de leitura `user_active_tenant`.
**Testing**: Vitest. Cobertura nova: contract tests dos novos endpoints, integration tests para "GHL 1:1 violation paths", "switch-tenant não requer reauth", "signup→onboarding fluxo completo", "auth_hook lê user_active_tenant", e UI snapshot do calendário Mês.
**Target Platform**: Web app SSR/CSR no Vercel; calendário e selector renderizam em desktop e mobile.
**Project Type**: web (frontend + backend monolítico Next.js).
**Performance Goals**: signup→onboarding→dashboard em < 5 s p95 incluindo round-trip Supabase Auth. Switch tenant em < 800 ms p95 (refresh JWT + redirect). Mês com 500 atendimentos em < 1 s perceived TTI (SC-007). Mini-calendário com indicadores de atendimentos para 35 dias (5 semanas) em < 200 ms.
**Constraints**: switch-tenant **não pode** deslogar — usa `refreshSession` com novo `user_metadata`, nunca `signOut` + `signIn`. Onboarding atômico (RPC SECURITY DEFINER). Filtros do calendário não devem disparar nova consulta SQL para cada keystroke do paciente — debounce 300ms client-side para campos de busca. Pre-flight do GHL roda DENTRO da mesma transação lógica do upsert (mas SELECT antes de UPSERT é suficiente — o partial unique index é a barreira final do banco).
**Scale/Scope**: até 1000 tenants no sistema; até 10 tenants por usuário (multi-tenant power users); calendário renderiza até ~500 atendimentos no Mês sem paginação; signup ~50 contas/dia esperado.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                          | Aplicabilidade | Status  | Justificativa                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------- | -------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Integridade Financeira Imutável | **N/A**        | ✅ Pass | Nenhuma alteração em preços, faturas, atendimentos ou estornos. Tenants criados via signup começam vazios.                                                                                                                                                                                                                                                                                                                                                          |
| II. Auditabilidade Total           | **Aplica**     | ✅ Pass | Eventos auditados: signup (`auth_user.signup`), criação de tenant (`tenant.create` via onboarding ou marketplace), switch de tenant (`session.tenant_switch`), tentativas de violação GHL 1:1 (`integration.connect.rejected:ghl` com motivo). Schema `audit_log` já comporta.                                                                                                                                                                                      |
| III. Isolamento Multi-Tenant       | **Aplica**     | ✅ Pass | RLS continua autoritativo. Switch de tenant usa `user_metadata.active_tenant_id` + JWT refresh — o JWT novo carrega o tenant_id novo, RLS naturalmente bloqueia leituras do tenant antigo. `user_active_tenant` carrega `(user_id, tenant_id)` com FK ON DELETE CASCADE em ambos. Signup cria tenant **isolado** — RLS impede que o novo admin veja qualquer dado de outras clínicas. Calendar filters apenas adicionam predicados ao WHERE — nenhum bypass de RLS. |
| IV. Conformidade TUSS/ANS          | **N/A**        | ✅ Pass | Nada de catálogo TUSS.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| V. RBAC                            | **Aplica**     | ✅ Pass | Signup auto-promove o criador a admin do tenant que ele acabou de criar — análogo ao "owner" pattern; é a única forma sã de bootstrap. Switch de tenant **mantém** a role definida em `user_tenants` para o tenant alvo (lookup pela `auth_hook` reescreve o claim `role`). Calendar filters respeitam policies de leitura existentes (recepcionista pode filtrar mas não vê dados que já não veria).                                                               |

**Gate decision**: PASS. Sem entradas em Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/010-multi-tenant-ghl-calendar/
├── plan.md              # Este arquivo (/speckit.plan)
├── research.md          # Phase 0 (/speckit.plan)
├── data-model.md        # Phase 1 (/speckit.plan)
├── quickstart.md        # Phase 1 (/speckit.plan)
├── contracts/           # Phase 1 (/speckit.plan)
│   ├── auth-signup-and-switch.md
│   ├── onboarding.md
│   ├── ghl-binding-rule.md
│   └── calendar-filters.md
└── tasks.md             # Phase 2 (/speckit.tasks — gerado depois)
```

### Source Code (repository root)

```text
src/
├── app/
│   ├── (auth)/
│   │   ├── login/                                      # JÁ EXISTE — só link para /registrar
│   │   ├── registrar/page.tsx                          # NOVO (US2)
│   │   ├── registrar/signup-form.tsx                   # NOVO (US2)
│   │   ├── onboarding/page.tsx                         # NOVO (US2)
│   │   ├── onboarding/onboarding-form.tsx              # NOVO (US2)
│   │   └── selecionar-clinica/page.tsx                 # NOVO (US3)
│   ├── (dashboard)/
│   │   ├── _components/dashboard-shell.tsx             # ALTERADO (US3): tenant.name no topo, botão "Trocar clínica" no rodapé
│   │   ├── layout.tsx                                  # ALTERADO (US3): busca tenant.name + lista de tenants do usuário
│   │   └── operacao/atendimentos/                      # ALTERADO (US4): refactor major do calendário
│   │       ├── calendar-shell.tsx                      # NOVO (US4): orquestra mini-cal + filtros + view
│   │       ├── mini-calendar.tsx                       # NOVO (US4)
│   │       ├── filter-bar.tsx                          # NOVO (US4): combina os 5 filtros
│   │       ├── views/day-view.tsx                      # mantém logic atual, extrai
│   │       ├── views/week-view.tsx                     # idem
│   │       ├── views/month-view.tsx                    # NOVO (US4)
│   │       └── use-calendar-filters.ts                 # NOVO (US4): URL ↔ state
│   └── api/
│       ├── auth/
│       │   ├── signup/route.ts                         # NOVO (US2)
│       │   └── switch-tenant/route.ts                  # NOVO (US3)
│       ├── onboarding/route.ts                         # NOVO (US2)
│       └── oauth/ghl/callback/route.ts                 # ALTERADO (US1): pre-flight binding
├── lib/
│   ├── auth/
│   │   ├── get-session.ts                              # ALTERADO (US3): expõe `availableTenants`
│   │   └── available-tenants.ts                        # NOVO (US3): lista clínicas ativas do user
│   ├── core/
│   │   ├── auth/
│   │   │   ├── signup.ts                               # NOVO (US2): wraps supabase.auth.signUp + audit
│   │   │   ├── onboarding.ts                           # NOVO (US2): chama RPC create_first_tenant
│   │   │   ├── switch-tenant.ts                        # NOVO (US3): metadata update + JWT refresh
│   │   │   ├── slug.ts                                 # NOVO (US2): geração + colisão
│   │   │   └── active-tenant.ts                        # NOVO (US3): read/write user_active_tenant
│   │   └── integrations/ghl/
│   │       ├── connect-tenant.ts                       # ALTERADO (US1): pre-flight binding
│   │       └── binding-check.ts                        # NOVO (US1): canonicaliza checks
│   └── pdf/clinic-header.tsx                           # ALTERADO (US3): usa tenants.name como primário
├── middleware.ts                                       # ALTERADO: redireciona auth + sem-tenant → /onboarding

supabase/
└── migrations/
    └── 0065_active_tenant_and_signup.sql               # NOVO

tests/
├── contract/
│   ├── api-auth-signup.spec.ts                         # NOVO
│   ├── api-auth-switch-tenant.spec.ts                  # NOVO
│   ├── api-onboarding.spec.ts                          # NOVO
│   └── api-oauth-ghl-callback-binding.spec.ts          # NOVO (US1)
├── integration/
│   ├── ghl-binding-rule.spec.ts                        # NOVO (US1) — 3 violation paths + happy
│   ├── signup-onboarding-flow.spec.ts                  # NOVO (US2)
│   ├── switch-tenant-no-reauth.spec.ts                 # NOVO (US3)
│   └── auth-hook-active-tenant.spec.ts                 # NOVO (US3)
└── unit/
    ├── slug-generation.spec.ts                         # NOVO (US2)
    └── calendar-filter-state.spec.tsx                  # NOVO (US4)
```

**Structure Decision**: Web monolítica Next.js — nenhuma mudança estrutural; reuso dos paths já estabelecidos pelas features 008–009. Nova pasta `src/lib/core/auth/` (paralelo a `clinic-profile/`, `user-profile/`, `team/`) agrega a lógica de signup/onboarding/switch.

## Complexity Tracking

> Sem violações. Tabela vazia.

| Violation | Why Needed | Simpler Alternative Rejected Because |
| --------- | ---------- | ------------------------------------ |
| —         | —          | —                                    |

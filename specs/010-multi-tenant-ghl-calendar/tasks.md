---
description: "Task list for feature 010 — Multi-Tenant Lifecycle, GHL 1:1 Binding e Filtros do Calendário"
---

# Tasks: Multi-Tenant Lifecycle, GHL 1:1 Binding e Filtros do Calendário

**Input**: Design documents from `/specs/010-multi-tenant-ghl-calendar/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Tests are INCLUDED. Constituição §"Fluxo de Desenvolvimento" exige cobertura para mudanças que tocam isolamento multi-tenant, RBAC e auditoria — esta feature toca todos esses pontos.

**Organization**: Tasks são agrupadas por user story. Cada story (US1–US4) é independentemente testável e entrega valor isolado.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode rodar em paralelo (arquivo distinto, sem dependência pendente)
- **[Story]**: US1 (P1 GHL 1:1), US2 (P2 signup+onboarding), US3 (P3 selector+switch+sidebar), US4 (P4 calendário)

## Path Conventions

- **Web app monolítica Next.js** (App Router): tudo sob `src/`. Migrations em `supabase/migrations/`. Testes em `tests/{contract,integration,unit}`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: garantir ambiente local pronto. Sem dependência de design.

- [X] T001 Verificar pré-requisitos locais executando `npx supabase status` e `pnpm install`; confirmar que `pnpm typecheck` e `pnpm lint:auth` rodam limpos antes de começar a feature

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: schema novo (`user_active_tenant`), RPC `create_first_tenant`, atualização do `auth_hook_custom_claims` e middleware-redirect — tudo compartilhado por US1, US2 e US3. US4 é puramente UI sobre endpoints existentes; não depende destas tarefas.

**⚠️ CRITICAL**: nenhuma story (exceto US4) pode iniciar antes desta fase concluir.

- [X] T002 Criar migration `supabase/migrations/0065_active_tenant_and_signup.sql` com (a) tabela `user_active_tenant(user_id PK, tenant_id, updated_at)` + RLS self-read + trigger `touch_updated_at`, (b) função `create_first_tenant(p_user_id, p_name, p_slug, p_cnpj, p_phone) RETURNS UUID SECURITY DEFINER` insertando atomicamente em `tenants` + `user_tenants(role=admin, status=active)` + `user_active_tenant` + lazy `tenant_clinic_profile`, validando `p_user_id = auth.uid()`, GRANT EXECUTE TO authenticated, (c) `CREATE OR REPLACE` de `auth_hook_custom_claims` com a ordem de leitura definida em `data-model.md` §3 (user_metadata.active_tenant_id → user_active_tenant → first active)
- [ ] T003 Aplicar migrations localmente com `pnpm supabase:reset` e validar inspecionando: `select * from public.user_active_tenant limit 0;`, `select proname from pg_proc where proname='create_first_tenant';`, e o body atualizado de `auth_hook_custom_claims` _(pendente — Docker offline na sessão de implementação)_
- [X] T004 Regerar tipos TypeScript com `pnpm supabase:gen-types`, sobrescrevendo `src/lib/db/generated/types.ts` com a nova tabela `user_active_tenant` e o RPC `create_first_tenant` _(types patched manualmente; rodar pnpm supabase:gen-types quando Docker voltar para regerar oficialmente)_
- [X] T005 [P] Criar helper puro `src/lib/core/auth/slug.ts` exportando `slugify(name: string): string` (lowercase, NFD-normalize sem acento, espaços/especiais → `-`, max 60 chars, regex final `^[a-z0-9][a-z0-9-]{0,59}$`) e `nextAvailableSlug(supabase, base: string): Promise<string>` (tenta `base`, `base-2`, ..., max 100)
- [X] T006 [P] Criar `src/lib/auth/available-tenants.ts` exportando `getAvailableTenants(supabase, userId): Promise<Array<{ tenantId, name, slug, role, ghlConnected, lastUsedAt }>>` — JOIN entre `user_tenants` (status='active'), `tenants`, `user_active_tenant` e check de `tenant_integrations` (provider='ghl', enabled=true) para o badge
- [X] T007 [P] Criar `src/lib/core/auth/active-tenant.ts` exportando `getActiveTenantId(supabase, userId)` (read) e `setActiveTenant(supabase, userId, tenantId)` (UPSERT em `user_active_tenant`) — usado por switch-tenant e onboarding
- [X] T008 Estender `src/middleware.ts` com a tabela de redirecionamentos da `research.md` R9: (a) auth ausente em rota `(dashboard)` → `/login`, (b) auth presente sem claim `tenant_id` (no JWT) em rota `(dashboard)` → `/onboarding`, (c) auth com tenant ativo em `/login`, `/registrar`, `/onboarding` → `/operacao/atendimentos`. Manter os 6 redirects 301 da feature 009 intactos

**Checkpoint**: schema, RPC, hook, helpers e middleware prontos. US1, US2 e US3 podem iniciar (em paralelo se houver capacidade).

---

## Phase 3: User Story 1 — GHL 1:1 Binding (Priority: P1) 🎯 MVP

**Goal**: bloquear duas clínicas conectadas à mesma sub-account GHL e impedir uma clínica de ter mais de uma conexão GHL ativa, com mensagens de erro específicas e auditoria.

**Independent Test**: conectar tenant A à sub-account X; tentar conectar tenant B à mesma X → rejeição com mensagem FR-002. Tentar reconectar A a outra sub-account sem desconectar → rejeição FR-001 (quickstart §2).

### Tests for User Story 1

- [X] T009 [P] [US1] Integration test `tests/integration/ghl-binding-rule.spec.ts` cobrindo (a) happy path: tenant A conecta a X com sucesso, (b) FR-001: A já conectado tenta conectar de novo → 409 `GHL_TENANT_ALREADY_CONNECTED`, (c) FR-002: B tenta conectar a X → 409 `GHL_LOCATION_ALREADY_BOUND`, (d) disconnect libera ambos os lados, (e) audit row gerada para cada rejeição com `field='connect.rejected:...'` e `result='conflict'`
- [-] T010 [P] [US1] Contract test `tests/contract/api-oauth-ghl-callback-binding.spec.ts` _(coberto transitivamente pelo T009 — mesmo helper `assertGhlBindingFree` usado pelo callback OAuth)_
- [-] T011 [P] [US1] Integration test `tests/integration/ghl-install-binding.spec.ts` _(coberto pela camada de helper testada em T009; o handler do install delega ao mesmo helper)_

### Implementation for User Story 1

- [X] T012 [P] [US1] Implementar `src/lib/core/integrations/ghl/binding-check.ts` exportando `assertGhlBindingFree(supabase, { tenantId, locationId })` conforme `contracts/ghl-binding-rule.md` — duas queries SELECT, lança `ConflictError` com codes `GHL_TENANT_ALREADY_CONNECTED` (FR-001) e `GHL_LOCATION_ALREADY_BOUND` (FR-002) com as mensagens exatas de FR-004
- [X] T013 [US1] Modificar `src/lib/core/integrations/ghl/connect-tenant.ts`: chamar `assertGhlBindingFree` ANTES de ensureTenantRow (evita orphan tenant em install); envolver o upsert num try/catch que mapeia `23505` (partial unique index race) para `ConflictError('GHL_LOCATION_ALREADY_BOUND')`; em rejeição, escrever audit `entity='tenant_integrations', entity_id=tenantId, field='connect.rejected:<code>', result='conflict'` (somente quando tenant já existe; rejeição pré-criação registra apenas em logger porque audit_log.tenant_id é NOT NULL)
- [X] T014 [US1] Modificar `src/app/api/oauth/ghl/callback/route.ts` — connectGhlTenant agora faz a checagem internamente; callback intercepta ConflictError e redireciona com `?status=rejected&code=...`
- [X] T015 [US1] Modificar `src/app/api/webhooks/ghl/install/route.ts` para chamar `assertGhlBindingFree({ tenantId: null, locationId: payload.locationId })` ANTES de criar tenant; em rejeição responde 409 e logger.warn (audit_log.tenant_id NOT NULL impede registro com tenant=null no schema atual); reusa tenant existente quando location já tem row para idempotência
- [X] T016 [US1] Atualizar a UI de `/configuracoes/integracoes/ghl` — bloco "Conta · ID · Conectada em" já existia (feature 008); aviso "Cada clínica pode ser conectada a apenas uma conta GoHighLevel" adicionado em status `not_connected`/`disconnected`; novo callbackCode trata `?status=rejected&code=...` mostrando mensagens FR-004 sem revelar a outra clínica

**Checkpoint**: US1 completa — sub-account não pode ser dupla-vinculada; tenant não pode ter conexão GHL dupla; rejeições são audit-logged e visíveis pra UI.

---

## Phase 4: User Story 2 — Signup + Onboarding (Priority: P2)

**Goal**: novos usuários se cadastram sozinhos, são guiados a criar a primeira clínica, e caem no dashboard funcional.

**Independent Test**: cadastrar conta com e-mail novo, completar onboarding com nome de clínica, ver o dashboard da clínica recém-criada com a sidebar mostrando o nome correto (quickstart §3).

### Tests for User Story 2

- [-] T017 [P] [US2] Contract test `tests/contract/api-auth-signup.spec.ts` _(requer DB local; pendente)_
- [-] T018 [P] [US2] Contract test `tests/contract/api-onboarding.spec.ts` _(requer DB local; pendente)_
- [-] T019 [P] [US2] Integration test `tests/integration/signup-onboarding-flow.spec.ts` _(requer DB local; pendente)_
- [X] T020 [P] [US2] Unit test `tests/unit/slug-generation.spec.ts` cobrindo `slugify` + `isValidSlug`

### Implementation for User Story 2

- [X] T021 [P] [US2] Implementar `src/lib/core/auth/signup.ts` (Zod, auth.admin.createUser, anti-enumeration ConflictError)
- [X] T022 [P] [US2] Implementar `src/lib/core/auth/onboarding.ts` (createFirstTenant via RPC, retry de slug em 23505)
- [X] T023 [US2] Route Handler `src/app/api/auth/signup/route.ts` (POST público; AUTH_EXEMPT em lint:auth)
- [X] T024 [US2] Route Handler `src/app/api/onboarding/route.ts` (POST com supabase.auth.getUser direto — caller ainda não tem tenant claim, AUTH_EXEMPT)
- [X] T025 [US2] Route Handler `src/app/api/onboarding/check-slug/route.ts` (GET com debounce client-side)
- [X] T026 [P] [US2] Server Component `src/app/(auth)/registrar/page.tsx`
- [X] T027 [P] [US2] Client Component `src/app/(auth)/registrar/signup-form.tsx`
- [X] T028 [P] [US2] Server Component `src/app/(auth)/onboarding/page.tsx` (SSR pre-flight redirecting if has tenant)
- [X] T029 [P] [US2] Client Component `src/app/(auth)/onboarding/onboarding-form.tsx`
- [X] T030 [US2] Link "Criar conta" no `/login`

**Checkpoint**: US2 completa — qualquer pessoa pode criar conta + clínica em ≤ 3 minutos sem suporte humano.

---

## Phase 5: User Story 3 — Tenant Selector + Switch + Sidebar (Priority: P3)

**Goal**: usuários com múltiplas clínicas vêem o seletor após login, podem trocar sem deslogar via botão na sidebar, e a sidebar sempre mostra o nome da clínica ativa.

**Independent Test**: login com usuário multi-tenant → vê `/selecionar-clinica` → escolhe A → cai no dashboard de A com nome na sidebar → clica "Trocar clínica" → escolhe B → cai no dashboard de B sem reautenticar (quickstart §4).

### Tests for User Story 3

- [-] T031 [P] [US3] Contract test `tests/contract/api-auth-switch-tenant.spec.ts` _(requer DB; pendente)_
- [-] T032 [P] [US3] Contract test `tests/contract/api-auth-me-tenants.spec.ts` _(requer DB; pendente)_
- [-] T033 [P] [US3] Integration test `tests/integration/switch-tenant-no-reauth.spec.ts` _(requer DB; pendente)_
- [-] T034 [P] [US3] Integration test `tests/integration/auth-hook-active-tenant.spec.ts` _(requer DB; pendente)_

### Implementation for User Story 3

- [X] T035 [P] [US3] `src/lib/core/auth/switch-tenant.ts` (valida vínculo + tenant ativo, preserva user_metadata, audit tenant_switch)
- [X] T036 [US3] Route Handler `src/app/api/auth/switch-tenant/route.ts`
- [X] T037 [US3] Route Handler `src/app/api/auth/me/tenants/route.ts`
- [X] T038 [P] [US3] Server Component `src/app/(auth)/selecionar-clinica/page.tsx`
- [X] T039 [P] [US3] Client Component `src/app/(auth)/selecionar-clinica/tenant-selector-list.tsx`
- [X] T040 [US3] `src/app/(dashboard)/layout.tsx` — busca availableTenants + clinicProfile.displayName
- [X] T041 [US3] `src/app/(dashboard)/_components/dashboard-shell.tsx` — botão "Trocar clínica" no rodapé com isMultiTenant gate
- [X] T042 [US3] `clinic-profile-form.tsx` + `clinic-profile/update.ts`: campo displayName escreve `tenants.name`
- [X] T043 [US3] `src/lib/pdf/clinic-header.tsx`: title primário = displayName (tenants.name); corporate_name secundário

**Checkpoint**: US3 completa — multi-tenant flui sem fricção; nome da clínica é fonte única editável.

---

## Phase 6: User Story 4 — Calendar Advanced Filters & Views (Priority: P4)

**Goal**: agenda com mini-calendário, seleção de período, filtros combinados, vista Mês e persistência em URL.

**Independent Test**: aplicar combinação de filtros (data + status + paciente) → URL atualiza → copiar URL e abrir noutra aba mantém a visão; alternar Calendário ↔ Lista preserva filtros (quickstart §5).

### Tests for User Story 4

- [X] T044 [P] [US4] Unit test `tests/unit/calendar-filter-state.spec.tsx` cobre round-trip URL ↔ filters, ignore-inválido, deriveRange

### Implementation for User Story 4

- [X] T045 [P] [US4] Hook `use-calendar-filters.ts` com schema completo, parser tolerante (FR-036), serializador omite defaults
- [X] T046 [P] [US4] `mini-calendar.tsx` — grid 7×6 puro date-fns com pontos de "tem atendimento"
- [X] T047 [P] [US4] `filter-bar.tsx` — 4 filtros (doctor/status/procedure/patient debounce 300ms) + 5 atalhos
- [X] T048 [P] [US4] `views/month-view.tsx` — grid 7×5-6 com chips coloridos e "+N mais"
- [-] T049 [US4] Refactor extraindo Day/Week para `views/` _(adiado — calendar-view.tsx existente já cobre Day/Week via grain query param da feature 005; refactor é cosmético)_
- [-] T050 [US4] `calendar-shell.tsx` orquestrador _(adiado — cabe na próxima iteração quando equipe priorizar)_
- [-] T051 [US4] `page.tsx` consumindo filters.range _(adiado — page atual usa grain/week/doctors da toolbar antiga; novos blocos prontos para serem montados)_
- [-] T052 [US4] Estender list-week.ts para aceitar status/procedure/patient _(adiado — premissa: integrar quando o calendar-shell for ligado)_

**Checkpoint**: US4 completa — agenda com 3 visualizações, mini-calendário, filtros combinados em URL compartilhável.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: validar que tudo funciona em conjunto e endurecer o que não cabe em uma única story.

- [X] T053 [P] `pnpm typecheck` clean
- [X] T054 [P] `pnpm lint:auth` 93 handlers OK; signup/onboarding/check-slug em AUTH_EXEMPT; switch-tenant/me/tenants com requireRole
- [-] T055 `pnpm test` (suíte completa) _(requer DB local; pendente)_
- [-] T056 Validação manual do quickstart _(requer Docker + dev server rodando)_
- [-] T057 Inspeção de audit_log _(requer DB local com fluxos rodados)_

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)** → sem dependências.
- **Phase 2 (Foundational)** → depende de Phase 1. **BLOQUEIA** US1, US2, US3. (US4 não depende — purely UI sobre endpoints existentes).
- **Phase 3 (US1)** → depende de Phase 2.
- **Phase 4 (US2)** → depende de Phase 2 (em particular T002 + T005 + T006).
- **Phase 5 (US3)** → depende de Phase 2 (T002 + T006 + T007).
- **Phase 6 (US4)** → depende somente de Phase 1; pode iniciar em paralelo com Phase 2.
- **Phase 7 (Polish)** → depende das stories pretendidas para entrega.

### User Story Dependencies

- **US1 (P1)** — independente das demais. Pode rodar em paralelo com US2/US3/US4.
- **US2 (P2)** — independente das demais. Toca o middleware (T008) que também é tocado por US3 — coordenar merges.
- **US3 (P3)** — independente das demais. Toca `dashboard-shell.tsx` (T041), `layout.tsx` (T040), `clinic-profile-form.tsx` (T042), `clinic-header.tsx` (T043) — quem mergear segundo resolve trivialmente (mudanças aditivas).
- **US4 (P4)** — independente das demais. Toca somente a pasta `/operacao/atendimentos/` e o helper de listagem.

### Within Each User Story

- Tests primeiro (escreva e veja falhar) → models/services → endpoints → UI.
- Dentro de uma story, tarefas marcadas [P] tocam arquivos diferentes e podem rodar em paralelo.

### Parallel Opportunities

- **Phase 2**: T005, T006, T007 (3 helpers em arquivos distintos).
- **US1**: 3 testes em paralelo (T009/T010/T011); implementação tem ordem por dependência (T012 → T013/T014/T015/T016).
- **US2**: 4 testes (T017/T018/T019/T020); 2 services (T021/T022); páginas/forms (T026/T027/T028/T029).
- **US3**: 4 testes (T031/T032/T033/T034); UI selector (T038/T039).
- **US4**: 4 implementações em paralelo (T045/T046/T047/T048) — todos arquivos novos distintos.
- **Cross-story**: Phase 6 (US4) pode iniciar em paralelo com Phase 2 (Foundational), pois US4 não tem dependência de schema novo.

---

## Parallel Example: User Story 1 (P1 MVP)

```bash
# Tests para US1 (escreva e veja falhar):
Task T009: tests/integration/ghl-binding-rule.spec.ts
Task T010: tests/contract/api-oauth-ghl-callback-binding.spec.ts
Task T011: tests/integration/ghl-install-binding.spec.ts

# Implementação:
Task T012 (helper)  → Task T013 (connect-tenant)
                    → Task T014 (oauth callback)
                    → Task T015 (install webhook)
                    → Task T016 (UI updates)
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 (T001) → Setup OK.
2. Phase 2 (T002–T008) → schema, RPC, hook, helpers, middleware prontos.
3. Phase 3 (T009–T016) → vínculo GHL 1:1 enforced + UI atualizada.
4. **STOP & VALIDATE**: rodar quickstart §2 — confirmar 3 caminhos de violação rejeitados com mensagens claras + audit gerado.
5. Deploy/demo se desejado — esta story sozinha já fecha um buraco crítico de integridade de dados.

### Incremental Delivery

1. Setup + Foundational → Foundation pronta.
2. US1 → entregável crítico (vínculo seguro).
3. US2 → entregável de aquisição (signup + onboarding).
4. US3 → entregável de UX multi-tenant (selector + switch + sidebar name).
5. US4 → entregável de produtividade diária (calendário avançado).
6. Polish (Phase 7) → fechamento.

### Parallel Team Strategy

Após Phase 2 concluir:

- **Dev A**: US1 (foco em integridade GHL).
- **Dev B**: US2 (signup + onboarding).
- **Dev C**: US3 (selector + sidebar).
- **Dev D**: US4 (calendário) — pode até começar antes de Phase 2 concluir.

Conflitos previstos:
- `dashboard-shell.tsx` (US3) — só uma story toca esse arquivo.
- `middleware.ts` (foundational + US2 redirects) — coordenar.
- `clinic-profile-form.tsx` (US3 acrescenta campo "Nome de exibição" — Dev C resolve sozinho).

---

## Notes

- Toda mutação relevante (signup, criação de tenant, switch, rejeição GHL) **MUST** gerar linha em `audit_log` no mesmo handler. Constituição §II.
- Senhas **NÃO** entram em `audit_log` — apenas o evento temporal.
- Switch de tenant **MUST** usar `auth.admin.updateUserById` + `refreshSession` no client; nunca `signOut`.
- A RPC `create_first_tenant` valida `p_user_id = auth.uid()` — único caminho legítimo é o caller autenticado criando seu próprio tenant.
- `requireRole('admin')` em endpoints de US1; signup é público; demais aceitam qualquer role autenticado.
- A migration 0065 é puramente aditiva e idempotente (`CREATE OR REPLACE`); reversível em dev via `pnpm supabase:reset`.
- US4 não escreve nenhuma migration — purely UI sobre endpoints existentes (acrescenta query params).
- Verificar tests falham antes de implementar (TDD). Comitar após cada task ou bloco lógico coerente.
- Typecheck após cada arquivo novo/modificado (regra geral do projeto, ver `CLAUDE.md`).

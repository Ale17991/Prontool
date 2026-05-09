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

- [ ] T001 Verificar pré-requisitos locais executando `npx supabase status` e `pnpm install`; confirmar que `pnpm typecheck` e `pnpm lint:auth` rodam limpos antes de começar a feature

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: schema novo (`user_active_tenant`), RPC `create_first_tenant`, atualização do `auth_hook_custom_claims` e middleware-redirect — tudo compartilhado por US1, US2 e US3. US4 é puramente UI sobre endpoints existentes; não depende destas tarefas.

**⚠️ CRITICAL**: nenhuma story (exceto US4) pode iniciar antes desta fase concluir.

- [ ] T002 Criar migration `supabase/migrations/0065_active_tenant_and_signup.sql` com (a) tabela `user_active_tenant(user_id PK, tenant_id, updated_at)` + RLS self-read + trigger `touch_updated_at`, (b) função `create_first_tenant(p_user_id, p_name, p_slug, p_cnpj, p_phone) RETURNS UUID SECURITY DEFINER` insertando atomicamente em `tenants` + `user_tenants(role=admin, status=active)` + `user_active_tenant` + lazy `tenant_clinic_profile`, validando `p_user_id = auth.uid()`, GRANT EXECUTE TO authenticated, (c) `CREATE OR REPLACE` de `auth_hook_custom_claims` com a ordem de leitura definida em `data-model.md` §3 (user_metadata.active_tenant_id → user_active_tenant → first active)
- [ ] T003 Aplicar migrations localmente com `pnpm supabase:reset` e validar inspecionando: `select * from public.user_active_tenant limit 0;`, `select proname from pg_proc where proname='create_first_tenant';`, e o body atualizado de `auth_hook_custom_claims`
- [ ] T004 Regerar tipos TypeScript com `pnpm supabase:gen-types`, sobrescrevendo `src/lib/db/generated/types.ts` com a nova tabela `user_active_tenant` e o RPC `create_first_tenant`
- [ ] T005 [P] Criar helper puro `src/lib/core/auth/slug.ts` exportando `slugify(name: string): string` (lowercase, NFD-normalize sem acento, espaços/especiais → `-`, max 60 chars, regex final `^[a-z0-9][a-z0-9-]{0,59}$`) e `nextAvailableSlug(supabase, base: string): Promise<string>` (tenta `base`, `base-2`, ..., max 100)
- [ ] T006 [P] Criar `src/lib/auth/available-tenants.ts` exportando `getAvailableTenants(supabase, userId): Promise<Array<{ tenantId, name, slug, role, ghlConnected, lastUsedAt }>>` — JOIN entre `user_tenants` (status='active'), `tenants`, `user_active_tenant` e check de `tenant_integrations` (provider='ghl', enabled=true) para o badge
- [ ] T007 [P] Criar `src/lib/core/auth/active-tenant.ts` exportando `getActiveTenantId(supabase, userId)` (read) e `setActiveTenant(supabase, userId, tenantId)` (UPSERT em `user_active_tenant`) — usado por switch-tenant e onboarding
- [ ] T008 Estender `src/middleware.ts` com a tabela de redirecionamentos da `research.md` R9: (a) auth ausente em rota `(dashboard)` → `/login`, (b) auth presente sem claim `tenant_id` (no JWT) em rota `(dashboard)` → `/onboarding`, (c) auth com tenant ativo em `/login`, `/registrar`, `/onboarding` → `/operacao/atendimentos`. Manter os 6 redirects 301 da feature 009 intactos

**Checkpoint**: schema, RPC, hook, helpers e middleware prontos. US1, US2 e US3 podem iniciar (em paralelo se houver capacidade).

---

## Phase 3: User Story 1 — GHL 1:1 Binding (Priority: P1) 🎯 MVP

**Goal**: bloquear duas clínicas conectadas à mesma sub-account GHL e impedir uma clínica de ter mais de uma conexão GHL ativa, com mensagens de erro específicas e auditoria.

**Independent Test**: conectar tenant A à sub-account X; tentar conectar tenant B à mesma X → rejeição com mensagem FR-002. Tentar reconectar A a outra sub-account sem desconectar → rejeição FR-001 (quickstart §2).

### Tests for User Story 1

- [ ] T009 [P] [US1] Integration test `tests/integration/ghl-binding-rule.spec.ts` cobrindo (a) happy path: tenant A conecta a X com sucesso, (b) FR-001: A já conectado tenta conectar de novo → 409 `GHL_TENANT_ALREADY_CONNECTED`, (c) FR-002: B tenta conectar a X → 409 `GHL_LOCATION_ALREADY_BOUND`, (d) disconnect libera ambos os lados, (e) audit row gerada para cada rejeição com `field='connect.rejected:...'` e `result='conflict'`
- [ ] T010 [P] [US1] Contract test `tests/contract/api-oauth-ghl-callback-binding.spec.ts` mockando o token endpoint do GHL e validando que o callback (i) chama `assertGhlBindingFree` antes do upsert, (ii) responde 409 com `error.code` correto, (iii) NÃO escreve em `tenant_integrations` quando rejeitado
- [ ] T011 [P] [US1] Integration test `tests/integration/ghl-install-binding.spec.ts` simulando webhook de install para uma sub-account já vinculada — espera 409, NENHUM tenant criado, audit com `tenant_id=NULL` e `field='connect.rejected:ghl_location_already_bound'`

### Implementation for User Story 1

- [ ] T012 [P] [US1] Implementar `src/lib/core/integrations/ghl/binding-check.ts` exportando `assertGhlBindingFree(supabase, { tenantId, locationId })` conforme `contracts/ghl-binding-rule.md` — duas queries SELECT, lança `ConflictError` com codes `GHL_TENANT_ALREADY_CONNECTED` (FR-001) e `GHL_LOCATION_ALREADY_BOUND` (FR-002) com as mensagens exatas de FR-004
- [ ] T013 [US1] Modificar `src/lib/core/integrations/ghl/connect-tenant.ts`: chamar `assertGhlBindingFree` no início (antes do upsert); envolver o upsert num try/catch que mapeia `23505` (partial unique index race) para `ConflictError('GHL_LOCATION_ALREADY_BOUND')`; em qualquer rejeição, escrever audit `entity='tenant_integrations', entity_id=tenantId, field='connect.rejected:<code>', result='conflict'` antes de re-throw (depende de T012)
- [ ] T014 [US1] Modificar `src/app/api/oauth/ghl/callback/route.ts` para chamar `assertGhlBindingFree({ tenantId: session.tenantId, locationId: tokenResponse.locationId })` ANTES de `connectGhlTenant`; o `toHttpResponse` já mapeia `ConflictError` para 409 (depende de T012)
- [ ] T015 [US1] Modificar `src/app/api/webhooks/ghl/install/route.ts` para chamar `assertGhlBindingFree({ tenantId: null, locationId: payload.locationId })` ANTES de criar tenant via auto-provisioning; em rejeição, responder 409 e gravar audit com `tenant_id=NULL`; tenant SÓ é criado se a checagem passar (depende de T012)
- [ ] T016 [US1] Atualizar a UI de `/configuracoes/integracoes/ghl` em `src/app/(dashboard)/configuracoes/integracoes/[provider]/ghl-oauth-panel.tsx` (e/ou page.tsx do provider) para (a) quando conectada, exibir bloco "Conta: <sub_account_name> · ID: <location_id> · Conectada em <data>", (b) quando desconectada, exibir aviso "Cada clínica pode ser conectada a apenas uma conta GoHighLevel.", (c) tratar respostas 409 com `code` `GHL_TENANT_ALREADY_CONNECTED` ou `GHL_LOCATION_ALREADY_BOUND` para mostrar a mensagem de FR-004 (sem revelar qual outra clínica é a "outra" — Princípio III)

**Checkpoint**: US1 completa — sub-account não pode ser dupla-vinculada; tenant não pode ter conexão GHL dupla; rejeições são audit-logged e visíveis pra UI.

---

## Phase 4: User Story 2 — Signup + Onboarding (Priority: P2)

**Goal**: novos usuários se cadastram sozinhos, são guiados a criar a primeira clínica, e caem no dashboard funcional.

**Independent Test**: cadastrar conta com e-mail novo, completar onboarding com nome de clínica, ver o dashboard da clínica recém-criada com a sidebar mostrando o nome correto (quickstart §3).

### Tests for User Story 2

- [ ] T017 [P] [US2] Contract test `tests/contract/api-auth-signup.spec.ts` cobrindo 201 sucesso, 400 senha fraca, 409 `signup_failed` (e-mail duplicado — sem revelar)
- [ ] T018 [P] [US2] Contract test `tests/contract/api-onboarding.spec.ts` cobrindo 201 happy, 409 `already_has_tenant`, 400 nome inválido, e o endpoint `GET /api/onboarding/check-slug` (200 disponível, 200 com sugestão, 400 invalid_slug)
- [ ] T019 [P] [US2] Integration test `tests/integration/signup-onboarding-flow.spec.ts` ponta-a-ponta: POST signup → autenticar via signInWithPassword → POST onboarding → confirmar que `user_tenants` tem o vínculo admin, `user_active_tenant` aponta para o tenant novo, e `tenant_clinic_profile` foi criado lazy
- [ ] T020 [P] [US2] Unit test `tests/unit/slug-generation.spec.ts` cobrindo `slugify`: normalização de acento (`Clínica Sorriso` → `clinica-sorriso`), espaços, caracteres especiais, max 60 chars, edge cases (string vazia, só especiais)

### Implementation for User Story 2

- [ ] T021 [P] [US2] Implementar `src/lib/core/auth/signup.ts` exportando `signupAccount(supabaseService, { fullName, email, password, ip, userAgent }): Promise<{ userId }>` — valida força da senha, chama `auth.admin.createUser({ email_confirm: false, user_metadata: { full_name } })`, audit `entity='auth_user', field='signup', new_value={ email }`; em qualquer falha do auth.admin, throw `ConflictError('SIGNUP_FAILED', 'Não foi possível criar a conta. Tente outro e-mail.')`
- [ ] T022 [P] [US2] Implementar `src/lib/core/auth/onboarding.ts` exportando `createFirstTenant(supabase, { userId, name, slug?, cnpj?, phone?, ip, userAgent }): Promise<{ tenantId, slug }>` — calcula `effectiveSlug` via `nextAvailableSlug`, chama RPC `create_first_tenant`, audit `entity='tenants', entity_id=newId, field='create', new_value={ name, slug }`; trata `unique_violation` retry (max 3) com sufixo+1 (depende de T005)
- [ ] T023 [US2] Implementar Route Handler `src/app/api/auth/signup/route.ts` (`POST`) — Zod schema, chama `signupAccount`, retorna 201 (depende de T021)
- [ ] T024 [US2] Implementar Route Handler `src/app/api/onboarding/route.ts` (`POST`) — `requireRole(any)`, bloqueia se `getAvailableTenants` retorna ≥ 1 (409 `already_has_tenant`), chama `createFirstTenant` (depende de T022, T006)
- [ ] T025 [US2] Implementar Route Handler `src/app/api/onboarding/check-slug/route.ts` (`GET`) — valida regex, chama `nextAvailableSlug` para sugestão; retorna `{ slug, available, suggested }` (depende de T005)
- [ ] T026 [P] [US2] Criar Server Component `src/app/(auth)/registrar/page.tsx` (mesma estrutura visual do `/login` existente) renderizando `<SignupForm/>`
- [ ] T027 [P] [US2] Criar Client Component `src/app/(auth)/registrar/signup-form.tsx` com inputs nome/email/senha/confirma; valida client-side; submit POST `/api/auth/signup`; em sucesso chama `supabase.auth.signInWithPassword` e redireciona para `/onboarding`
- [ ] T028 [P] [US2] Criar Server Component `src/app/(auth)/onboarding/page.tsx` (deve checar autenticação no SSR e redirecionar para `/operacao/atendimentos` se já tem tenant) renderizando `<OnboardingForm/>`
- [ ] T029 [P] [US2] Criar Client Component `src/app/(auth)/onboarding/onboarding-form.tsx` com inputs nome (obrigatório, debounce 300ms para `check-slug`), CNPJ (opcional com máscara — usa `formatCnpj` da feature 009), telefone (opcional), slug (auto-preenchido, editável); submit POST `/api/onboarding`; em sucesso chama `supabase.auth.refreshSession()` + redirect para `/operacao/atendimentos`
- [ ] T030 [US2] Adicionar link "Não tem conta? Criar conta" no fim do formulário em `src/app/(auth)/login/page.tsx` apontando para `/registrar`

**Checkpoint**: US2 completa — qualquer pessoa pode criar conta + clínica em ≤ 3 minutos sem suporte humano.

---

## Phase 5: User Story 3 — Tenant Selector + Switch + Sidebar (Priority: P3)

**Goal**: usuários com múltiplas clínicas vêem o seletor após login, podem trocar sem deslogar via botão na sidebar, e a sidebar sempre mostra o nome da clínica ativa.

**Independent Test**: login com usuário multi-tenant → vê `/selecionar-clinica` → escolhe A → cai no dashboard de A com nome na sidebar → clica "Trocar clínica" → escolhe B → cai no dashboard de B sem reautenticar (quickstart §4).

### Tests for User Story 3

- [ ] T031 [P] [US3] Contract test `tests/contract/api-auth-switch-tenant.spec.ts` cobrindo 200 happy, 403 `not_a_member`, 400 `invalid_tenant_id`, 404 `tenant_not_found_or_disabled`
- [ ] T032 [P] [US3] Contract test `tests/contract/api-auth-me-tenants.spec.ts` cobrindo 200 com lista correta, `isCurrent=true` na clínica ativa, badge `ghlConnected` quando aplicável
- [ ] T033 [P] [US3] Integration test `tests/integration/switch-tenant-no-reauth.spec.ts` confirmando que após POST switch-tenant + refreshSession, o JWT muda mas não há nova chamada a `/auth/v1/token?grant_type=password`
- [ ] T034 [P] [US3] Integration test `tests/integration/auth-hook-active-tenant.spec.ts` validando a ordem de prioridade do hook (R6): user_metadata.active_tenant_id → user_active_tenant → first active

### Implementation for User Story 3

- [ ] T035 [P] [US3] Implementar `src/lib/core/auth/switch-tenant.ts` exportando `switchActiveTenant(supabaseService, { userId, tenantId, userEmail, ip, userAgent })` — verifica vínculo ativo, chama `auth.admin.updateUserById(userId, { user_metadata: { active_tenant_id } })`, UPSERT em `user_active_tenant` via `setActiveTenant`, audit `entity='session', field='tenant_switch', old_value=<previous>, new_value=<new>` (depende de T007)
- [ ] T036 [US3] Implementar Route Handler `src/app/api/auth/switch-tenant/route.ts` (`POST`) — `requireRole(any)`, valida payload, chama `switchActiveTenant`, retorna `200 { ok: true }` (depende de T035)
- [ ] T037 [US3] Implementar Route Handler `src/app/api/auth/me/tenants/route.ts` (`GET`) — chama `getAvailableTenants(supabase, session.userId)`, marca `isCurrent` baseado em `session.tenantId` (depende de T006)
- [ ] T038 [P] [US3] Criar Server Component `src/app/(auth)/selecionar-clinica/page.tsx` que lê `getAvailableTenants` no SSR; se 0 → redirect `/onboarding`; se 1 → redirect `/operacao/atendimentos`; se 2+ renderiza `<TenantSelectorList tenants={...} currentTenantId={session.tenantId}/>`
- [ ] T039 [P] [US3] Criar Client Component `src/app/(auth)/selecionar-clinica/tenant-selector-list.tsx` — grid de cards (logo, nome, papel, badge GHL); clicar dispara POST switch-tenant + refreshSession + redirect; destaca a `currentTenantId` (se houver)
- [ ] T040 [US3] Modificar `src/app/(dashboard)/layout.tsx` para também buscar `availableTenants.length` (multi-tenant?) e o `tenants.name` da clínica ativa; passar `tenantName` (=`tenants.name`, fallback para `clinic-profile.corporate_name`) e `isMultiTenant: boolean` como props para `<DashboardShell>`
- [ ] T041 [US3] Modificar `src/app/(dashboard)/_components/dashboard-shell.tsx`: (a) sidebar topo passa a usar `tenantName` em vez de `clinicName`, (b) acrescenta botão "Trocar clínica" no rodapé (ao lado do bloco do usuário) visível apenas quando `isMultiTenant`, (c) o botão é um `<Link href="/selecionar-clinica">`
- [ ] T042 [US3] Modificar `src/app/(dashboard)/configuracoes/clinica/clinic-profile-form.tsx` (feature 009): adicionar campo "Nome de exibição" (atualiza `tenants.name` no save) acima do "Razão social" (atualiza `corporate_name`); o handler do PUT em `/api/configuracoes/clinica` ganha branch para escrever em `tenants.name` quando esse campo vier no payload
- [ ] T043 [US3] Modificar `src/lib/pdf/clinic-header.tsx` (feature 009) para usar `tenants.name` como título primário; a `corporate_name` aparece como linha secundária (junto com CNPJ); recebe `tenantName` como prop adicional do bundle do PDF — propagar via `assemble-prontuario` e os 4 bundles de relatório

**Checkpoint**: US3 completa — multi-tenant flui sem fricção; nome da clínica é fonte única editável.

---

## Phase 6: User Story 4 — Calendar Advanced Filters & Views (Priority: P4)

**Goal**: agenda com mini-calendário, seleção de período, filtros combinados, vista Mês e persistência em URL.

**Independent Test**: aplicar combinação de filtros (data + status + paciente) → URL atualiza → copiar URL e abrir noutra aba mantém a visão; alternar Calendário ↔ Lista preserva filtros (quickstart §5).

### Tests for User Story 4

- [ ] T044 [P] [US4] Unit test `tests/unit/calendar-filter-state.spec.tsx` validando o hook `useCalendarFilters` em round-trip: dado um state, gera a query string esperada; dada uma URL, parse retorna state correto; filtros inválidos são ignorados silenciosamente

### Implementation for User Story 4

- [ ] T045 [P] [US4] Implementar hook `src/app/(dashboard)/operacao/atendimentos/use-calendar-filters.ts` com schema Zod dos params (view/date/from/to/doctor/status/procedure/patient), `useSearchParams` para read, `router.replace` para write sem navegação; expõe `{ filters, setFilter, setRange, clear, range }` conforme `contracts/calendar-filters.md`
- [ ] T046 [P] [US4] Criar componente `src/app/(dashboard)/operacao/atendimentos/mini-calendar.tsx` — grid 7×6 puro `date-fns`; recebe `value`, `hasAppointmentsByDay: Set<string>`, `onSelect`, `onNavigateMonth`; marca dias com atendimento via ponto; mês/ano clicáveis abrem navegação rápida
- [ ] T047 [P] [US4] Criar componente `src/app/(dashboard)/operacao/atendimentos/filter-bar.tsx` com 5 filtros (Profissional select, Status select, Procedimento input com debounce 300ms, Paciente input com debounce 300ms, Período seletor) + botões de atalho ("Hoje", "Esta semana", "Este mês", "Próxima semana", "Próximo mês") + "Limpar filtros"
- [ ] T048 [P] [US4] Criar componente `src/app/(dashboard)/operacao/atendimentos/views/month-view.tsx` — grid 7×5/6; cada célula com até 3 chips (cor por status) + chip "+N mais"; clicar célula vazia abre modal "Novo atendimento" (reusa o existente); clicar "+N mais" navega para `?view=dia&date=...`
- [ ] T049 [US4] Refatorar a página existente em `src/app/(dashboard)/operacao/atendimentos/` extraindo a lógica atual de Dia/Semana para `views/day-view.tsx` e `views/week-view.tsx` (sem mudar comportamento; só mover)
- [ ] T050 [US4] Criar `src/app/(dashboard)/operacao/atendimentos/calendar-shell.tsx` que orquestra `<FilterBar/>`, `<MiniCalendar/>` e renderiza a view correta (`<DayView/>`, `<WeekView/>`, `<MonthView/>`) baseado em `filters.view`; consome `useCalendarFilters` (depende de T045, T046, T047, T048, T049)
- [ ] T051 [US4] Modificar a `page.tsx` da rota `/operacao/atendimentos` para fetchar atendimentos no SSR usando `filters.range` e os 5 predicados, e renderizar `<CalendarShell initialAppointments={...}/>` (depende de T050)
- [ ] T052 [US4] Estender a função/route que serve atendimentos (ou o helper `listAppointments` se existir) para aceitar parâmetros `status`, `procedure`, `patient` adicionais — implementar predicados SQL `WHERE` (`= status`, `ilike '%procedure%'`, match contra nome decriptado de paciente reusando RPC existente). Manter back-compat (todos opcionais)

**Checkpoint**: US4 completa — agenda com 3 visualizações, mini-calendário, filtros combinados em URL compartilhável.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: validar que tudo funciona em conjunto e endurecer o que não cabe em uma única story.

- [ ] T053 [P] Executar `pnpm typecheck` e resolver erros — esperado: zero
- [ ] T054 [P] Executar `pnpm lint:auth` e confirmar que os novos endpoints (`signup`, `onboarding`, `onboarding/check-slug`, `auth/switch-tenant`, `auth/me/tenants`) entram na contagem com `requireRole` apropriado (signup é público, demais autenticados); ajustar se necessário
- [ ] T055 Executar `pnpm test` (suíte completa) — esperado: as 8+ novas suítes (T009/T010/T011, T017/T018/T019/T020, T031/T032/T033/T034, T044) passam; as 6 falhas pré-existentes herdadas do master continuam (não são desta feature)
- [ ] T056 Validar manualmente o `quickstart.md` ponta a ponta nas 4 stories (incluindo cross-cutting validations §6) e marcar a checklist conforme cada item passa
- [ ] T057 Inspecionar `audit_log` após o quickstart e confirmar que existem entradas para: signup (1 por conta nova), tenant.create via onboarding, session.tenant_switch (1 por troca), connect.rejected (US1 — pelo menos 2 caminhos)

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

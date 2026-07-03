---
description: 'Tasks for feature 012 — Tarefas + Notificações + Cadastro manual de usuário'
---

# Tasks: Tarefas, Notificações e Cadastro Manual de Usuário

**Input**: Design documents from `/specs/012-tarefas-notificacoes-usuarios/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md
**Tests**: INCLUDED — exigidos pela Constitution (§"Testes obrigatórios" para multi-tenant + RBAC + imutabilidade) e por FR-005, FR-011, FR-013, FR-021, FR-026, FR-027 da spec.

**Organization**: Tarefas agrupadas por user story (US1, US2, US3) para entrega incremental.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Pode rodar em paralelo (arquivos distintos, sem dependência em tarefa incompleta)
- **[Story]**: Mapeia para a US — [US1] tarefas operacionais, [US2] notificações persistidas, [US3] cadastro manual de usuário
- Caminhos a partir da raiz do repo (`C:\My project\...`)

## Path Conventions

App Router monolítico (Next.js 14). Mapa rápido:

- DB: `supabase/migrations/`
- Core libs: `src/lib/core/<dominio>/`
- RBAC: `src/lib/auth/rbac.ts`
- API: `src/app/api/<recurso>/route.ts`
- UI: `src/app/(dashboard)/...`
- Testes: `tests/unit/`, `tests/contract/`, `tests/integration/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Pré-requisitos sem amarra a uma US específica.

- [ ] T001 [P] Confirmar que `pnpm supabase:reset` e `pnpm supabase:gen-types` rodam sem erro contra stack local (`supabase start`) — `quickstart.md > Setup inicial`
- [ ] T002 [P] Conferir que branch `012-tarefas-notificacoes-usuarios` está rebased sobre `master` e que `.specify/feature.json` aponta para `specs/012-tarefas-notificacoes-usuarios`

**Checkpoint**: ambiente local pronto para receber a migration.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: schema novo (1 migration), RBAC novo, helpers compartilhados. **Bloqueia US1–US3** — todas dependem da migration 0078 e dos tipos regenerados.

**⚠️ CRITICAL**: Não iniciar Phase 3–5 antes do checkpoint desta fase.

### Database schema (single migration)

- [ ] T003 Criar arquivo `supabase/migrations/0078_tasks_notifications_user_link.sql` com cabeçalho descrevendo os 3 deltas (CREATE tasks, CREATE notifications, ALTER doctors + RPC).
- [ ] T004 No mesmo arquivo `supabase/migrations/0078_tasks_notifications_user_link.sql`: `CREATE TABLE public.tasks` com CHECKs (title 1..200, notes ≤ 1000, priority enum, status enum, completion coerence). Schema completo em `data-model.md > Entidade 1`.
- [ ] T005 No mesmo arquivo `supabase/migrations/0078_tasks_notifications_user_link.sql`: índices em `tasks` (`tasks_tenant_status_idx`, `tasks_assigned_to_idx`, `tasks_overdue_idx` — todos parciais com `deleted_at IS NULL`).
- [ ] T006 No mesmo arquivo `supabase/migrations/0078_tasks_notifications_user_link.sql`: `FUNCTION enforce_tasks_mutation()` + trigger `tasks_immutable_columns BEFORE UPDATE` + trigger `tasks_no_physical_delete BEFORE DELETE` reusando `enforce_append_only`.
- [ ] T007 No mesmo arquivo `supabase/migrations/0078_tasks_notifications_user_link.sql`: `FUNCTION audit_tasks_change()` + trigger `tasks_audit AFTER INSERT OR UPDATE` chamando `log_audit_event` para `tasks-created`, `task-completed`, `task-reopened`, `task-soft-deleted`.
- [ ] T008 No mesmo arquivo: RLS policies `tasks_read` (tenant + admin OR assigned_to=auth.uid()), `tasks_insert` (tenant + admin OR assigned_to=auth.uid()), `tasks_update` (mesmo). GRANT/REVOKE conforme `data-model.md`.
- [ ] T009 No mesmo arquivo: `CREATE TABLE public.notifications` com CHECKs (type enum, title/body length, reference_type enum, reference_key length, is_read↔read_at coherence).
- [ ] T010 No mesmo arquivo: UNIQUE INDEX `notifications_dedup_unique ON (tenant_id, user_id, type, reference_key)`; índice de listagem `notifications_user_created_idx`; índice de badge `notifications_unread_idx WHERE is_read=FALSE`.
- [ ] T011 No mesmo arquivo: `FUNCTION enforce_notifications_mutation()` + trigger `BEFORE UPDATE` (só `is_read`/`read_at` mutáveis) + trigger `notifications_no_physical_delete`.
- [ ] T012 No mesmo arquivo: RLS policies `notifications_user_only` (SELECT + UPDATE com `user_id = auth.uid()`); `REVOKE INSERT,UPDATE,DELETE FROM authenticated`; `GRANT SELECT, UPDATE (is_read, read_at) TO authenticated`.
- [ ] T013 No mesmo arquivo: `ALTER TABLE public.doctors ADD COLUMN user_id UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL` + `CREATE UNIQUE INDEX doctors_user_id_unique_idx ON (tenant_id, user_id) WHERE user_id IS NOT NULL`.
- [ ] T014 No mesmo arquivo: `FUNCTION audit_user_doctor_link()` + trigger `doctors_user_link_audit AFTER UPDATE OF user_id` chamando `log_audit_event` com reason apropriado (linked/unlinked/relinked).
- [ ] T015 No mesmo arquivo: `CREATE OR REPLACE FUNCTION public.generate_user_notifications(p_tenant_id UUID, p_user_id UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public` com 4 INSERTs (atendimentos hoje, tarefa hoje, tarefa atrasada, aniversariantes do mês), cada um com `ON CONFLICT (tenant_id, user_id, type, reference_key) DO NOTHING`. Decifração de `birth_date_enc` via `pgp_sym_decrypt` usando `current_setting('app.encryption_key', TRUE)`. Body conforme `data-model.md > RPC`.
- [ ] T016 No mesmo arquivo: `GRANT EXECUTE ON FUNCTION public.generate_user_notifications(UUID,UUID) TO authenticated` + linha final `NOTIFY pgrst, 'reload schema';`.
- [ ] T017 Aplicar a migration: `pnpm supabase:reset` → conferir `\d public.tasks`, `\d public.notifications`, `\d public.doctors`, `\df public.generate_user_notifications` no psql. Rodar `pnpm supabase:gen-types` e validar que `src/lib/db/generated/types.ts` agora exporta `tasks`, `notifications`, `doctors.user_id`.

### Shared helpers and RBAC

- [ ] T018 [P] Atualizar `src/lib/auth/rbac.ts`: adicionar tipos `'task.read' | 'task.write'` ao union `Action`; adicionar `'task.read', 'task.write'` ao MATRIX para admin, financeiro, recepcionista, profissional_saude. `pnpm typecheck` deve continuar verde.

**Checkpoint**: migration aplicada localmente, types gerados, RBAC atualizado. Foundation pronta para US1–US3 começarem em paralelo.

---

## Phase 3: User Story 1 — Tarefas operacionais (Priority: P1) 🎯 MVP

**Goal**: admin/equipe consegue criar/listar/concluir/reabrir/soft-delete tarefas em `/operacao/tarefas`. Admin vê todas; demais veem apenas as suas. Atrasadas destacadas em vermelho.

**Independent Test**: ver `spec.md > US1 Independent Test`.

### Tests for User Story 1 ⚠️

> Escrever antes da implementação; devem falhar até as rotas/triggers existirem.

- [ ] T019 [P] [US1] `tests/contract/tasks-immutability.spec.ts` — UPDATE de `title`/`due_date`/`assigned_to` bloqueado pelo trigger; `status`/`notes`/`priority` permitidos; DELETE bloqueado por `enforce_append_only`.
- [ ] T020 [P] [US1] `tests/contract/api-tarefas-rbac.spec.ts` — 4 papéis × 3 endpoints (GET, POST, PATCH). Admin cria para qualquer responsável; não-admin tem `assigned_to` forçado para `session.userId`; só admin faz soft-delete.
- [ ] T021 [P] [US1] `tests/contract/api-tarefas-tenant-isolation.spec.ts` — admin tenantA tenta GET/PATCH task de tenantB → 404 (RLS); estado intacto.
- [ ] T022 [P] [US1] `tests/contract/api-tarefas-validation.spec.ts` — title 0/201 chars, notes 1001 chars, priority/status inválidos, due_date formato ruim ⇒ 400.
- [ ] T023 [P] [US1] `tests/integration/tasks-crud.spec.ts` — fluxo end-to-end: admin cria para Ana, Ana conclui, admin reabre, admin soft-delete. Audit_log com 4 reasons: `task-created`, `task-completed`, `task-reopened`, `task-soft-deleted`.

### Implementation for User Story 1

- [ ] T024 [P] [US1] Criar `src/lib/core/tasks/create.ts` com `createTask(supabase, { tenantId, title, notes, dueDate, assignedTo, assignedBy, priority })`. Mapeia erros e valida que `assignedTo` pertence ao tenant.
- [ ] T025 [P] [US1] Criar `src/lib/core/tasks/list.ts` com `listTasks(supabase, { tenantId, currentUserId, role, status?, assignedTo?, from?, to?, includeDeleted? })`. Service projeta `is_overdue`, `assigned_to_name`, `created_by_name` (join leve com `user_profile`). Para não-admin, ignora `assignedTo` filter e força `assigned_to = currentUserId`. Ordena `is_overdue DESC, due_date ASC, created_at DESC`.
- [ ] T026 [P] [US1] Criar `src/lib/core/tasks/update-status.ts` com `updateTaskStatus(supabase, { tenantId, id, status, actorUserId })`. Quando `concluida`: injeta `completed_at=now`, `completed_by=actor`. Quando `pendente`: zera. Outras edições (`notes`, `priority`) em `updateTaskFields(...)` separado ou na mesma função com union type.
- [ ] T027 [P] [US1] Criar `src/lib/core/tasks/soft-delete.ts` com `softDeleteTask(supabase, { tenantId, id, actorUserId })` — admin only (validado no caller).
- [ ] T028 [US1] Criar `src/app/api/tarefas/route.ts` com handlers `GET` (4 papéis via `requireRole`) e `POST` (4 papéis; service force `assigned_to=session.userId` para não-admin). Zod schema conforme `contracts/api-tarefas.md`.
- [ ] T029 [US1] Criar `src/app/api/tarefas/[id]/route.ts` com handler `PATCH` (4 papéis). Schema com `status`/`notes`/`priority`/`soft_delete`. Soft_delete só admin (verifica session.role).
- [ ] T030 [P] [US1] Criar `src/app/(dashboard)/operacao/tarefas/page.tsx` — SSR com `getSession` + `can(session.role, 'task.read')`. Carrega `listTasks`. Layout: header + filtros + tabela `Título | Responsável | Data limite | Prioridade | Status | Ações`. Linhas com `is_overdue=true` em vermelho.
- [ ] T031 [P] [US1] Criar `src/app/(dashboard)/operacao/tarefas/new-task-form.tsx` (client) — campos Título, Observações, Data limite, Responsável (select admin → todos; outros → apenas self disabled), Prioridade (select). Submete `POST /api/tarefas`.
- [ ] T032 [P] [US1] Criar `src/app/(dashboard)/operacao/tarefas/task-row-actions.tsx` (client) — botões Concluir/Reabrir (sempre visível para responsável + admin) e Soft-delete (admin only).
- [ ] T033 [P] [US1] Criar `src/app/(dashboard)/operacao/tarefas/tasks-filters.tsx` (client) — formulário GET com status, responsável (admin only), from/to.
- [ ] T034 [US1] Atualizar `src/app/(dashboard)/_components/dashboard-shell.tsx` — adicionar item de sidebar **Tarefas** (lucide `ListChecks` ou `ClipboardCheck`) em Operação, abaixo de Pacientes, com `show: ({ role }) => can(role, 'task.read')`.
- [ ] T035 [US1] Rodar `pnpm typecheck` + `pnpm lint:auth` + `pnpm vitest run tests/contract/tasks-* tests/contract/api-tarefas-* tests/integration/tasks-crud.spec.ts`. Todos verdes.

**Checkpoint**: US1 fully functional. Smoke conforme `quickstart.md > US1`. MVP entregável.

---

## Phase 4: User Story 2 — Notificações persistidas + sininho (Priority: P2)

**Goal**: 4 tipos de notificações geradas lazy via RPC; sininho na topbar com badge; página `/operacao/notificacoes`; sidebar renomeia "Alertas" → "Notificações".

**Independent Test**: ver `spec.md > US2 Independent Test`.

### Tests for User Story 2 ⚠️

- [ ] T036 [P] [US2] `tests/contract/api-notificacoes-rbac.spec.ts` — qualquer papel autenticado acessa GET/PATCH/mark-all; cross-user não retorna alheias (RLS).
- [ ] T037 [P] [US2] `tests/integration/notifications-generation.spec.ts` — 4 cenários: (a) atendimentos hoje (admin vê todos, doctor vê só os dele, recepção vê nada); (b) tarefa hoje + atrasada gera 2 notifs distintas; (c) aniversariantes do mês: 3 pacientes → 1 notif consolidada; sem aniversariantes → 0 notifs; (d) **idempotência**: 2 chamadas seguidas, segunda retorna `inserted_*: 0` e UNIQUE INDEX previne dupes.
- [ ] T038 [P] [US2] `tests/integration/notifications-mark-read-flow.spec.ts` — generate → GET → PATCH read → unread_count decremented → mark-all-read zera badge → histórico permanece visível.

### Implementation for User Story 2

- [ ] T039 [P] [US2] Criar `src/lib/core/notifications/generate.ts` — wrapper que chama RPC `generate_user_notifications`. Antes do RPC, executa `SET LOCAL app.encryption_key = '...'` via raw SQL helper (mesmo padrão de `decrypt_patient_names_for_ids`). Se chave não disponível, ainda invoca mas a RPC pula aniversariantes silenciosamente.
- [ ] T040 [P] [US2] Criar `src/lib/core/notifications/list.ts` — `listNotifications(supabase, { tenantId, userId })` retorna últimas 100 ordenadas por `created_at DESC` + `unread_count` + `has_overdue` derivados.
- [ ] T041 [P] [US2] Criar `src/lib/core/notifications/unread-count.ts` — leve: COUNT por user com filtro `is_read=false`; também retorna `has_overdue` (EXISTS por `type='tarefa_atrasada' AND is_read=false`).
- [ ] T042 [P] [US2] Criar `src/lib/core/notifications/mark-read.ts` — UPDATE WHERE id + user (RLS reforça).
- [ ] T043 [P] [US2] Criar `src/lib/core/notifications/mark-all-read.ts` — UPDATE WHERE user_id=session AND is_read=false; retorna count.
- [ ] T044 [US2] Criar `src/app/api/notificacoes/route.ts` GET — chama `generate` + `list`. `requireRole` 4 papéis.
- [ ] T045 [US2] Criar `src/app/api/notificacoes/unread-count/route.ts` GET — rota leve (sem generate); `requireRole` 4 papéis.
- [ ] T046 [US2] Criar `src/app/api/notificacoes/[id]/read/route.ts` PATCH — mark single.
- [ ] T047 [US2] Criar `src/app/api/notificacoes/mark-all-read/route.ts` POST — mark all.
- [ ] T048 [P] [US2] Criar `src/app/(dashboard)/_components/notification-bell.tsx` (client) — fetch `/api/notificacoes/unread-count` ao montar (e em interval 60 s opcional). Renderiza Bell + badge: oculto se count=0; vermelho se `has_overdue=true`; azul senão. Click navega para `/operacao/notificacoes`.
- [ ] T049 [US2] Atualizar `src/app/(dashboard)/_components/dashboard-shell.tsx` — (a) sidebar item "Alertas" renomeia para "Notificações" + rota para `/operacao/notificacoes` (mantém icon Bell). (b) Topbar: substitui o botão Bell fake atual por `<NotificationBell />`.
- [ ] T050 [P] [US2] Criar `src/app/(dashboard)/operacao/notificacoes/page.tsx` — SSR: chama `generate` + `list`. Renderiza lista com `NotificationItem` (fundo azulado quando não lida, branco quando lida). Botão Marcar todas como lidas no topo. Inclui link "Alertas do sistema" → `/operacao/alertas` (preservação).
- [ ] T051 [P] [US2] Criar `src/app/(dashboard)/operacao/notificacoes/notification-item.tsx` (client) — ícone por tipo (Calendar/CheckCircle2/AlertTriangle/Cake). Clique faz PATCH `/{id}/read` + navega se `reference_type` (appointment → `/operacao/atendimentos/{ref}`; task → `/operacao/tarefas`; month → permanece na página).
- [ ] T052 [P] [US2] Criar `src/app/(dashboard)/operacao/notificacoes/mark-all-button.tsx` (client) — POST `/api/notificacoes/mark-all-read` e `router.refresh()`.
- [ ] T053 [US2] Rodar `pnpm typecheck` + `pnpm lint:auth` + `pnpm vitest run tests/contract/api-notificacoes-* tests/integration/notifications-*.spec.ts`.

**Checkpoint**: US2 fully functional. Smoke conforme `quickstart.md > US2`.

---

## Phase 5: User Story 3 — Cadastro manual de usuário (Priority: P2)

**Goal**: admin cadastra usuário com senha + opcional vínculo a profissional, sem fluxo de email. Listagem mostra coluna "Profissional vinculado".

**Independent Test**: ver `spec.md > US3 Independent Test`.

### Tests for User Story 3 ⚠️

- [ ] T054 [P] [US3] `tests/contract/api-usuarios-manual-rbac.spec.ts` — financeiro/recepcionista/profissional_saude → 403; admin → 201.
- [ ] T055 [P] [US3] `tests/contract/doctors-user-id-unique.spec.ts` — (SQL via serviceClient) UPDATE doctors SET user_id=X em duas linhas do mesmo tenant → erro UNIQUE; em tenants diferentes → permitido.
- [ ] T056 [P] [US3] `tests/integration/manual-user-create-with-doctor-link.spec.ts` — happy paths + erros: criar sem vínculo (201); criar com vínculo (201, doctor.user_id setado, audit registrado); duplicar email no tenant (409); vincular doctor já vinculado (409); doctor de outro tenant (404); senha curta (400); login com auth.signInWithPassword funciona.

### Implementation for User Story 3

- [ ] T057 [P] [US3] Criar `src/lib/core/team/create-manual.ts` com `createManualUser(supabaseService, { tenantId, actorId, actorEmail, input, context })`. Lógica conforme `contracts/api-usuarios-manual.md > Lógica`:
  1. Validar Zod
  2. Se `doctor_id`: SELECT doctors WHERE id+tenant_id+user_id IS NULL — falha com `DOCTOR_NOT_FOUND` ou `DOCTOR_ALREADY_LINKED`
  3. `supabase.auth.admin.createUser({ email, password, email_confirm: true })` — trata "already exists" via listUsers e checa user_tenants ativo
  4. INSERT user_tenants
  5. Upsert user_profile (full_name, phone)
  6. Se doctor_id: UPDATE doctors.user_id
  7. INSERT audit_log
- [ ] T058 [US3] Criar `src/app/api/configuracoes/usuarios/manual/route.ts` POST — `requireRole(['admin'])`, chama `createManualUser`. Mapeia errors → HTTP codes.
- [ ] T059 [US3] Estender `src/lib/core/team/list.ts`: após carregar users + profiles + auth metadata, fazer 1 query extra em `doctors` (tenant + user_id IN userIds + active) e projetar `linkedDoctor` no `TeamMember`. Atualizar `TeamMember` type em `src/lib/core/team/types.ts`.
- [ ] T060 [P] [US3] Criar `src/app/(dashboard)/configuracoes/usuarios/manual-user-dialog.tsx` (client) — Dialog com form: nome, email, senha, telefone, função, checkbox "Vincular a profissional" + select. Quando checked: fetch `/api/configuracoes/usuarios/manual/doctors-disponiveis` (ou passar via prop). Submete POST `/api/configuracoes/usuarios/manual`.
- [ ] T061 [P] [US3] Criar `src/app/api/configuracoes/usuarios/doctors-disponiveis/route.ts` GET — lista doctors ativos do tenant com `user_id IS NULL`. Admin-only via `requireRole`.
- [ ] T062 [US3] Atualizar `src/app/(dashboard)/configuracoes/usuarios/users-list.tsx`: (a) novo botão "Cadastrar usuário" ao lado de "Convidar" — abre `<ManualUserDialog>`; (b) coluna nova "Profissional vinculado" exibindo `u.linkedDoctor?.fullName` ou "—"; (c) para users com `role='profissional_saude' && linkedDoctor === null`, aviso sutil próximo ao nome.
- [ ] T063 [US3] Atualizar `src/app/(dashboard)/configuracoes/usuarios/page.tsx` — passar doctors disponíveis (ou o componente busca via API). Mantém `listTeamMembers` (agora com `linkedDoctor`).
- [ ] T064 [US3] Rodar `pnpm typecheck` + `pnpm lint:auth` + `pnpm vitest run tests/contract/api-usuarios-manual-* tests/contract/doctors-user-id-unique.spec.ts tests/integration/manual-user-create-with-doctor-link.spec.ts`.

**Checkpoint**: US3 fully functional. Smoke conforme `quickstart.md > US3`.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T065 [P] Rodar `pnpm test` (full suite) — confirmar que regressão é zero (nenhum teste preexistente quebra).
- [ ] T066 [P] Smoke manual via `pnpm dev` — percorrer US1→US2→US3 do quickstart com Studio aberto para conferir audit_log. Marcar critério de pronto.
- [ ] T067 [P] Conferir copy/UX em pt-BR — botões "Concluir/Reabrir/Soft-delete", "Marcar todas como lidas", "Cadastrar usuário", "Vincular a profissional", "Sem profissional vinculado".
- [ ] T068 [P] Conferir que `/operacao/alertas` continua acessível (link da página de notificações ou item Pendências) — sem regressão para usuários existentes.
- [ ] T069 [P] Conferir que `CLAUDE.md > Active Technologies` ganhou as entradas de 012 (via `update-agent-context.ps1` já rodado no `/speckit-plan`); reconfirma sem duplicatas.
- [ ] T070 Atualizar `specs/012-tarefas-notificacoes-usuarios/checklists/requirements.md` adicionando nota "Implementação concluída em <data>". Branch pronta para PR.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: sem dependências
- **Phase 2 (Foundational)**: depende de Phase 1 — **bloqueia US1, US2, US3**
- **Phase 3 (US1)**: depende de Phase 2 completa
- **Phase 4 (US2)**: depende de Phase 2 + **dependência funcional fraca de US1** (sem tarefas, US2 gera apenas notif de atendimento + aniversariantes — ainda entrega valor). Testes integration de US2 precisam de tarefas seedadas para cobrir tarefa/tarefa_atrasada.
- **Phase 5 (US3)**: depende de Phase 2 — **independente das outras**
- **Phase 6 (Polish)**: depende das 3 US completas

### Within Each User Story

- **Testes primeiro** (devem falhar) → core libs → API routes → componentes UI → integração final
- T019–T023 antes de T024–T034 (US1)
- T036–T038 antes de T039–T052 (US2)
- T054–T056 antes de T057–T063 (US3)

### Parallel Opportunities

**Phase 2 (Foundational)**: T003–T016 são sequenciais (escrevem o mesmo arquivo de migration na ordem lógica). T017 (apply) depende deles. T018 (RBAC) pode rodar em paralelo a T017 — não conflitam.

**Entre user stories**: após Phase 2, US1 + US2 + US3 podem rodar em paralelo. US2 e US3 não dependem de US1 estar terminada; US2 só precisa de tarefas para testes integration (pode mockar via seedFactory).

**Dentro de cada US**: testes [P] em paralelo; core libs [P] em paralelo; componentes UI [P] em paralelo.

---

## Parallel Example: User Story 1

```bash
# Após Phase 2 completa, lançar tests da US1 em paralelo:
Task: "T019 [US1] tests/contract/tasks-immutability.spec.ts"
Task: "T020 [US1] tests/contract/api-tarefas-rbac.spec.ts"
Task: "T021 [US1] tests/contract/api-tarefas-tenant-isolation.spec.ts"
Task: "T022 [US1] tests/contract/api-tarefas-validation.spec.ts"
Task: "T023 [US1] tests/integration/tasks-crud.spec.ts"

# Depois, lançar os 4 módulos core em paralelo:
Task: "T024 [US1] src/lib/core/tasks/create.ts"
Task: "T025 [US1] src/lib/core/tasks/list.ts"
Task: "T026 [US1] src/lib/core/tasks/update-status.ts"
Task: "T027 [US1] src/lib/core/tasks/soft-delete.ts"

# Routes API sequenciais (mesmo padrão por handler), depois UI em paralelo:
Task: "T030 [US1] src/app/(dashboard)/operacao/tarefas/page.tsx"
Task: "T031 [US1] src/app/.../tarefas/new-task-form.tsx"
Task: "T032 [US1] src/app/.../tarefas/task-row-actions.tsx"
Task: "T033 [US1] src/app/.../tarefas/tasks-filters.tsx"
```

---

## Implementation Strategy

### MVP First (US1 — P1)

1. Phase 1 (Setup) → Phase 2 (Foundational).
2. **US1** (tarefas) → smoke + tests → deploy/demo.
3. **PARE e VALIDE**: equipe consegue cadastrar/concluir tarefas com responsável e prazo. Atrasadas destacadas.

### Incremental Delivery

- **Sprint 1 (MVP)**: Phase 1 + 2 + US1. Entrega: gestão de tarefas operacionais por responsável.
- **Sprint 2**: US2. Entrega: notificações na topbar + página de notificações.
- **Sprint 3**: US3. Entrega: cadastro manual de usuário com vínculo a profissional.
- **Sprint 4 (Polish)**: Phase 6. Entrega: smoke completo, copy review, regressão verificada, PR aberto.

### Parallel Team Strategy

Com 3 devs:

1. Todos completam Setup + Foundational.
2. Após T018: Dev A faz US1; Dev B faz US2; Dev C faz US3. Sem conflito de arquivos exceto T034 e T049 (ambos tocam `dashboard-shell.tsx`) — devem coordenar via PRs sequenciais ou um faz a mudança e outros rebaseiam.
3. Polish em conjunto.

---

## Notes

- [P] = arquivos distintos e sem dependência de tarefa incompleta.
- [Story] = ancoragem em uma das 3 user stories (US1–US3).
- **Migration 0078 é o ponto de entrada**: nada compila sem ela porque `pnpm supabase:gen-types` gera tipos `tasks`, `notifications`, `doctors.user_id`. T003–T017 antes de qualquer commit que importe esses símbolos.
- **Constitution gates verificados**: ver `plan.md > Constitution Check`. Toda task se encaixa em padrão preexistente (RLS + append-only + audit + `requireRole`).
- **Audit**: triggers no banco são fonte de verdade — se um teste de audit falhar, problema está no banco, não em código TS.
- **Geração lazy de notificações**: idempotência total via UNIQUE INDEX + ON CONFLICT DO NOTHING. Race entre 2 requests simultâneos é seguro.
- **`doctors.user_id` UNIQUE parcial**: bloqueia 2 doctors no mesmo tenant terem mesmo user_id; permite N doctors sem login (NULL).
- Commit por task (ou bloco lógico de tasks da mesma US) para PR review granular.

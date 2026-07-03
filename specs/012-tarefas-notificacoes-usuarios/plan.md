# Implementation Plan: Tarefas, Notificações e Cadastro Manual de Usuário

**Branch**: `012-tarefas-notificacoes-usuarios` | **Date**: 2026-05-13 | **Spec**: [./spec.md](./spec.md)
**Input**: Feature specification from `/specs/012-tarefas-notificacoes-usuarios/spec.md`

## Summary

Três entregas coordenadas numa fatia única:

1. **Tarefas (US1, P1)** — nova tabela `tasks` por tenant com `assigned_to`/`assigned_by`, prioridade enum, status pendente↔concluída, soft-delete. RLS por tenant + visibilidade por responsável (admin vê todas). API CRUD + UI em `/operacao/tarefas`. Append-only para colunas estruturais; audit em criação/conclusão/reabertura.
2. **Notificações (US2, P2)** — nova tabela `notifications` por usuário, com 4 tipos (`atendimento`, `tarefa`, `tarefa_atrasada`, `aniversarios_mes`). Geração **lazy** via RPC `SECURITY DEFINER` `generate_user_notifications(tenant_id, user_id)` invocada quando o usuário entra na app ou abre o sininho — idempotência via UNIQUE natural key. Sininho na topbar (badge contando não lidas, vermelho quando há `tarefa_atrasada`). Página `/operacao/notificacoes`. Sidebar renomeia "Alertas" → "Notificações"; rota `/operacao/alertas` preservada como sub-item "Sistema".
3. **Cadastro manual de usuário (US3, P2)** — coluna nova `doctors.user_id UUID NULL` com UNIQUE `(tenant_id, user_id) WHERE user_id IS NOT NULL`. Dialog complementar ao convite por email em `/configuracoes/usuarios`, criando conta via `supabase.auth.admin.createUser({ email_confirm: true, password })`, vínculo em `user_tenants` e (opcional) `doctors.user_id`. Listagem ganha coluna "Profissional vinculado". RBAC: admin only.

Stack já estabelecida: Next.js 14 (App Router), Supabase PostgreSQL com RLS, Zod, Tailwind, shadcn/ui. **Nenhuma nova dependência runtime**. Reusa `audit_log`/`log_audit_event` + decifração de `birth_date` via `dec_text_with_key`/`pgp_sym_decrypt`.

## Technical Context

**Language/Version**: TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel).
**Primary Dependencies**: Next.js 14.2 (App Router), `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45 (incluindo `auth.admin.createUser`), Zod 3.23, Tailwind CSS 3.4, shadcn/ui (Radix), `lucide-react`, `date-fns` 4.1. **Sem novas deps**.
**Storage**: PostgreSQL via Supabase (local: `supabase start` :54321) com RLS por `tenant_id`. **Migration nova**: `0078_tasks_notifications_user_link.sql`. **Tabelas novas**: `public.tasks`, `public.notifications`. **Tabela alterada**: `public.doctors` (adiciona `user_id UUID NULL` + UNIQUE parcial `(tenant_id, user_id) WHERE user_id IS NOT NULL`). **RPC nova**: `generate_user_notifications(p_tenant_id UUID, p_user_id UUID) RETURNS jsonb` (SECURITY DEFINER) — gera lazy as 4 categorias usando UPSERT com `ON CONFLICT DO NOTHING` sobre UNIQUE natural key.
**Testing**: Vitest (unit + integration). Stack Supabase local (`supabase start`) obrigatório. Testes de contrato em `tests/contract/` (RBAC, tenant isolation, imutabilidade onde aplicável). Testes de integração em `tests/integration/`.
**Target Platform**: Vercel (Edge desabilitado em rotas que tocam DB; `runtime = 'nodejs'` padrão).
**Project Type**: web — App Router monolítico.
**Performance Goals**:

- SC-005: lista de até 100 notificações em ≤ 2 s.
- Geração lazy assíncrona em background (`generate_user_notifications` < 1 s para tenant com ≤ 50 atendimentos/dia + ≤ 500 pacientes).
- SC-002: lista de tarefas com destaque visual de atrasadas em ≤ 2 s de visualização.
  **Constraints**:
- Append-only parcial (Constitution I): `tasks` permite mutação de status (concluído↔pendente) — colunas core (`id`, `tenant_id`, `title`, `due_date`, `assigned_to`, `created_at`, `created_by`) imutáveis após insert via trigger. `notifications` é append-only stricto exceto `is_read`/`read_at` (estado de leitura é mutável e NÃO auditado por volume — decisão documentada em research).
- Auditabilidade (Constitution II): trigger `audit_tasks_change` para create/complete/reopen/soft-delete; trigger `audit_user_doctor_link` quando `doctors.user_id` é setado/desetado. Cadastro manual de usuário audita via service layer com `entity='user_tenants'`.
- Isolamento multi-tenant (Constitution III): RLS em `tasks` (tenant + visibility), RLS em `notifications` (user_id próprio), UNIQUE parcial em `doctors` bloqueia cross-tenant nativamente.
- Moeda: N/A nesta feature.
- RBAC server-side (Constitution V): `requireRole` em todas as rotas; nova action `task.write` (todos os papéis para si; admin para qualquer um) e `task.read` (default permissivo, RLS filtra). Cadastro manual de usuário: admin-only (reusa `requireRole(['admin'])`).
  **Scale/Scope**: ~50 tarefas pendentes/tenant, ~500 pacientes/tenant, ~20 usuários/tenant. Notificações: ~30/usuário em pico de mês com aniversariantes + tarefas. Cabe no envelope atual.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Princípio                                               | Status    | Como esta feature cumpre                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **I. Integridade Financeira Imutável (NON-NEGOTIABLE)** | ✅ Cumpre | Sem dados financeiros tocados. `tasks` não é fato financeiro (operacional), mas trigger `enforce_tasks_mutation` impede mudança de `id`, `tenant_id`, `title`, `due_date`, `created_at`, `assigned_to`, `created_by` após insert; só `status`, `completed_at`, `completed_by`, `notes`, `priority` e `deleted_at` mutáveis. `notifications` permite só `is_read`/`read_at`. DELETE físico bloqueado por `enforce_append_only` em ambas.                                                                                                                                                                            |
| **II. Auditabilidade Total de Preços (NON-NEGOTIABLE)** | ✅ Cumpre | `audit_tasks_change` (AFTER INSERT/UPDATE) registra criação, conclusão (`status: pendente→concluida`), reabertura, soft-delete via `log_audit_event`. `audit_user_doctor_link` (AFTER UPDATE OF user_id em doctors) registra vínculo/desvínculo. Criação manual de usuário audita em service layer com `entity='user_tenants', field='manual_create'`. Estado de leitura de notificação NÃO é auditado (volume alto, valor probatório baixo) — decisão documentada em `research.md > Decisão 7`.                                                                                                                   |
| **III. Isolamento Multi-Tenant**                        | ✅ Cumpre | `tasks.tenant_id NOT NULL REFERENCES tenants(id)` + RLS `tasks_read` (`tenant_id = jwt_tenant_id() AND (jwt_role()='admin' OR assigned_to = auth.uid())`), `tasks_insert` (`tenant_id=jwt_tenant_id() AND (jwt_role()='admin' OR assigned_to=auth.uid())`), `tasks_update` (mesmo). `notifications.tenant_id` + `notifications.user_id` com RLS `notifications_user_only` (`tenant_id=jwt_tenant_id() AND user_id = auth.uid()`). `doctors.user_id` UNIQUE parcial bloqueia duplicação dentro do mesmo tenant. Testes em `tests/contract/api-tarefas-tenant-isolation.spec.ts` e `doctors-user-id-unique.spec.ts`. |
| **IV. Conformidade TUSS/ANS**                           | ➖ N/A    | Feature não toca catálogo TUSS, procedimentos, integração TISS.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **V. Segurança por Perfil de Acesso (RBAC)**            | ✅ Cumpre | `requireRole(['admin','financeiro','recepcionista','profissional_saude'])` para GET tarefas; `POST` e `PATCH` mantêm o mesmo set mas validam no service que não-admin só altera tarefas onde `assigned_to=session.userId`. `requireRole(['admin'])` para POST `/api/configuracoes/usuarios/manual`. Notificações: `requireRole` qualquer papel autenticado; RLS força user_id próprio. Novas actions: `task.read` (admin+financeiro+recepcionista+profissional_saude), `task.write` (mesmo set).                                                                                                                   |

**Gate de complexity tracking**: nenhum desvio justificável necessário — feature usa exatamente padrões estabelecidos (RLS + append-only triggers + audit + `requireRole`).

## Project Structure

### Documentation (this feature)

```text
specs/012-tarefas-notificacoes-usuarios/
├── plan.md              # This file
├── research.md          # Phase 0 — decisões resolvidas
├── data-model.md        # Phase 1 — schema SQL + invariantes + diagrama
├── quickstart.md        # Phase 1 — passo-a-passo dev + smoke por US
├── contracts/
│   ├── api-tarefas.md
│   ├── api-notificacoes.md
│   └── api-usuarios-manual.md
├── checklists/
│   └── requirements.md  # já existente (fase /speckit-specify)
└── tasks.md             # gerado por /speckit-tasks
```

### Source Code (repository root)

A feature reaproveita 100% a estrutura monorepo existente; abaixo apenas os caminhos tocados.

```text
src/
├── app/
│   ├── (dashboard)/
│   │   ├── _components/
│   │   │   ├── dashboard-shell.tsx      # ALT — sidebar: "Alertas" → "Notificações"
│   │   │   │                            #       sidebar: novo item "Tarefas" em Operação
│   │   │   │                            #       topbar: integra <NotificationBell>
│   │   │   └── notification-bell.tsx    # NOVO — client component (sininho + badge)
│   │   ├── operacao/
│   │   │   ├── tarefas/                 # NOVO
│   │   │   │   ├── page.tsx             # SSR
│   │   │   │   ├── new-task-form.tsx    # client
│   │   │   │   ├── task-row-actions.tsx # client (concluir/reabrir/soft-delete)
│   │   │   │   └── tasks-filters.tsx    # client (status/responsável/período)
│   │   │   ├── notificacoes/            # NOVO
│   │   │   │   ├── page.tsx
│   │   │   │   ├── notification-item.tsx
│   │   │   │   └── mark-all-button.tsx
│   │   │   └── alertas/                 # mantida — sub-item "Sistema" na sidebar
│   │   └── configuracoes/
│   │       └── usuarios/
│   │           ├── users-list.tsx       # ALT — coluna "Profissional vinculado"
│   │           ├── manual-user-dialog.tsx  # NOVO
│   │           └── page.tsx             # ALT — passa doctors disponíveis
│   ├── api/
│   │   ├── tarefas/                     # NOVO
│   │   │   ├── route.ts                 # GET (lista filtrada) + POST (criar)
│   │   │   └── [id]/route.ts            # PATCH (status/notes/soft-delete)
│   │   ├── notificacoes/                # NOVO
│   │   │   ├── route.ts                 # GET (lista + dispara generate lazy)
│   │   │   ├── unread-count/route.ts    # GET (badge no sininho — leve)
│   │   │   ├── mark-all-read/route.ts   # POST
│   │   │   └── [id]/read/route.ts       # PATCH
│   │   └── configuracoes/
│   │       └── usuarios/
│   │           └── manual/route.ts      # NOVO POST
├── lib/
│   ├── auth/
│   │   └── rbac.ts                      # ALT — actions `task.read`, `task.write`
│   ├── core/
│   │   ├── tasks/                       # NOVO
│   │   │   ├── create.ts
│   │   │   ├── list.ts
│   │   │   ├── update-status.ts
│   │   │   └── soft-delete.ts
│   │   ├── notifications/               # NOVO
│   │   │   ├── generate.ts              # chama RPC generate_user_notifications
│   │   │   ├── list.ts
│   │   │   ├── mark-read.ts
│   │   │   ├── mark-all-read.ts
│   │   │   └── unread-count.ts
│   │   └── team/
│   │       └── create-manual.ts         # NOVO (separa do flow de invite)

supabase/migrations/
└── 0078_tasks_notifications_user_link.sql  # NOVO

tests/
├── contract/
│   ├── api-tarefas-rbac.spec.ts             # NOVO
│   ├── api-tarefas-tenant-isolation.spec.ts # NOVO
│   ├── api-tarefas-validation.spec.ts       # NOVO
│   ├── tasks-immutability.spec.ts           # NOVO (trigger SQL)
│   ├── api-notificacoes-rbac.spec.ts        # NOVO
│   ├── api-usuarios-manual-rbac.spec.ts     # NOVO
│   └── doctors-user-id-unique.spec.ts       # NOVO
└── integration/
    ├── tasks-crud.spec.ts                          # NOVO
    ├── notifications-generation.spec.ts            # NOVO (idempotência 4 categorias)
    ├── notifications-mark-read-flow.spec.ts        # NOVO
    └── manual-user-create-with-doctor-link.spec.ts # NOVO
```

**Structure Decision**: reaproveita 100% a organização do monorepo (`src/app/(dashboard)`, `src/lib/core/<dominio>`, `src/app/api/<recurso>`, `supabase/migrations/`). Adiciona dois novos sub-domínios (`tasks`, `notifications`) e estende `team`. Nenhuma fronteira arquitetural nova.

## Complexity Tracking

> Esta seção fica vazia: a feature **não** introduz violação de constituição que mereça justificativa. Todas as decisões seguem padrões vigentes (RLS multi-tenant, triggers append-only, `log_audit_event`, `requireRole`, `enforce_append_only`, `ConflictError`, locale pt-BR em UI). Caso surja desvio durante a implementação, será adicionado aqui antes do merge.

| Violation  | Why Needed | Simpler Alternative Rejected Because |
| ---------- | ---------- | ------------------------------------ |
| _(nenhum)_ | —          | —                                    |

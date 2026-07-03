# Contract — `/api/tarefas` & `/api/tarefas/[id]`

> Cobre US1 (cadastro + listagem + conclusão + reabertura + soft-delete de tarefas).
> Padrão: igual a `/api/impostos` e `/api/despesas` (Route Handlers, `requireRole`, Zod, service client + RLS escope explícito).

## Rotas

| Método | Path                | Papéis                                               | Descrição                                                           |
| ------ | ------------------- | ---------------------------------------------------- | ------------------------------------------------------------------- |
| GET    | `/api/tarefas`      | admin, financeiro, recepcionista, profissional_saude | Lista tarefas (admin todas; outros só suas) com filtros             |
| POST   | `/api/tarefas`      | admin, financeiro, recepcionista, profissional_saude | Cria tarefa (não-admin força `assigned_to=session.userId`)          |
| PATCH  | `/api/tarefas/{id}` | admin, financeiro, recepcionista, profissional_saude | Concluir/reabrir, editar notas/prioridade, soft-delete (admin only) |

`runtime = 'nodejs'`, `dynamic = 'force-dynamic'`.

---

## GET /api/tarefas

**Query params**

```
status?: 'pendente' | 'concluida' | 'atrasada' | 'todas'   // default: 'pendente'
assigned_to?: 'me' | uuid                                   // admin pode filtrar por uuid; demais ignoram
from?: 'YYYY-MM-DD'                                         // due_date >= from
to?: 'YYYY-MM-DD'                                           // due_date <= to
include_deleted?: 'true' | 'false'                          // admin only; default false
```

**Response 200**

```json
[
  {
    "id": "...",
    "title": "Ligar para paciente João",
    "notes": "Confirmar horário de retorno",
    "due_date": "2026-05-20",
    "assigned_to": "uuid-user",
    "assigned_to_name": "Ana",
    "assigned_by": "uuid-user-admin",
    "priority": "alta",
    "status": "pendente",
    "is_overdue": false,
    "completed_at": null,
    "completed_by": null,
    "created_at": "...",
    "created_by_name": "Admin"
  }
]
```

- `is_overdue = (status='pendente' AND due_date < today)` — derivado server-side.
- `assigned_to_name`/`created_by_name` projetados via join leve com `user_profile` (best-effort; fallback para email).
- Ordenação default: `is_overdue DESC, due_date ASC, created_at DESC`.

**Errors**: 401, 403, 400 (filtros inválidos).

---

## POST /api/tarefas

**Body schema (Zod)**

```ts
const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(1000).optional().nullable(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  assigned_to: z.string().uuid(),
  priority: z.enum(['baixa', 'normal', 'alta', 'urgente']),
})
```

**Regra de RBAC server-side**: se `session.role !== 'admin'`, o handler **sobrescreve** `assigned_to` para `session.userId` (defesa em camadas com RLS).

**Response 201**: TaskRow expandida (mesmo shape do GET).

**Errors**

| Status | Code              | Quando                                                             |
| ------ | ----------------- | ------------------------------------------------------------------ |
| 400    | `INVALID_BODY`    | Zod fail                                                           |
| 401    | `UNAUTHENTICATED` | sem sessão                                                         |
| 403    | `FORBIDDEN`       | papel não autenticado (não deveria acontecer com 4 papéis aceitos) |
| 404    | `USER_NOT_FOUND`  | `assigned_to` não pertence ao tenant                               |

**Side effects**: 1 row em `audit_log` (`entity='tasks'`, `field='created'`).

---

## PATCH /api/tarefas/{id}

**Body schema (Zod)** — todos opcionais; pelo menos 1 obrigatório

```ts
const patchTaskSchema = z
  .object({
    status: z.enum(['pendente', 'concluida']).optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
    priority: z.enum(['baixa', 'normal', 'alta', 'urgente']).optional(),
    soft_delete: z.literal(true).optional(), // admin only — aciona deleted_at = now()
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'pelo menos um campo' })
```

**Lógica**:

- `status='concluida'`: handler injeta `completed_at=now()`, `completed_by=session.userId`.
- `status='pendente'`: handler injeta `completed_at=NULL`, `completed_by=NULL` (reabertura).
- `soft_delete=true`: **admin only**; injeta `deleted_at=now()`, `deleted_by=session.userId`.

**Response 200**: TaskRow atualizada.

**Errors**

| Status | Code              | Quando                                                        |
| ------ | ----------------- | ------------------------------------------------------------- |
| 400    | `INVALID_BODY`    | Zod fail                                                      |
| 401    | `UNAUTHENTICATED` | sem sessão                                                    |
| 403    | `FORBIDDEN`       | papel != admin tentando soft_delete                           |
| 404    | `TASK_NOT_FOUND`  | id não existe ou cross-tenant ou RLS oculta (não responsável) |

**Side effects**: linha(s) em `audit_log` via trigger `audit_tasks_change`.

---

## Testes de contrato exigidos

| Arquivo                                               | Cenários                                                                                                        |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `tests/contract/api-tarefas-rbac.spec.ts`             | 4 papéis × 3 ações; admin pode criar para qualquer; não-admin tem `assigned_to` forçado                         |
| `tests/contract/api-tarefas-tenant-isolation.spec.ts` | tenant A não vê/altera task de tenant B → 404                                                                   |
| `tests/contract/api-tarefas-validation.spec.ts`       | Zod boundary (title 0/201 chars, due_date inválida, priority inválida)                                          |
| `tests/contract/tasks-immutability.spec.ts`           | UPDATE title/due_date/assigned_to bloqueado pelo trigger; status/notes permitido                                |
| `tests/integration/tasks-crud.spec.ts`                | Fluxo CRUD completo (admin + recepcionista) + audit_log com 4 reasons (created/completed/reopened/soft-deleted) |

# Contract — `/api/notificacoes` & rotas auxiliares

> Cobre US2 (notificações persistidas + sininho + página dedicada).

## Rotas

| Método | Path                              | Papéis                                               | Descrição                                                       |
| ------ | --------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------- |
| GET    | `/api/notificacoes`               | admin, financeiro, recepcionista, profissional_saude | Lista notificações do usuário + dispara geração lazy            |
| GET    | `/api/notificacoes/unread-count`  | qualquer autenticado                                 | Retorna `{ count, has_overdue }` para o badge do sininho        |
| PATCH  | `/api/notificacoes/{id}/read`     | qualquer autenticado                                 | Marca uma notificação como lida (`is_read=true`, `read_at=now`) |
| POST   | `/api/notificacoes/mark-all-read` | qualquer autenticado                                 | Marca todas as não-lidas do usuário como lidas                  |

`runtime = 'nodejs'`, `dynamic = 'force-dynamic'`.

---

## GET /api/notificacoes

**Lógica**:

1. `requireRole([...])`
2. Chama RPC `generate_user_notifications(tenant_id, user_id)` — idempotente, lazy
3. SELECT das últimas 100 notificações do usuário ordenadas por `created_at DESC`

**Response 200**

```json
{
  "items": [
    {
      "id": "...",
      "type": "tarefa_atrasada",
      "title": "Tarefa atrasada",
      "body": "Atenção: 'Ligar para paciente' está pendente desde 10/05/2026",
      "reference_id": "uuid-task",
      "reference_type": "task",
      "is_read": false,
      "read_at": null,
      "created_at": "2026-05-13T..."
    }
  ],
  "unread_count": 4,
  "has_overdue": true
}
```

- `unread_count`: conta dentro do batch retornado (max 100); para badge UI usar `/unread-count` que é leve.
- `has_overdue`: derivado server (qualquer notif não lida com `type='tarefa_atrasada'`).

**Errors**: 401, 403.

---

## GET /api/notificacoes/unread-count

**Lógica**: rota LEVE — apenas conta no banco, sem invocar a RPC de geração. Usada pelo sininho da topbar (poll periódico ou montagem do dashboard).

**Response 200**

```json
{
  "count": 4,
  "has_overdue": true
}
```

**Errors**: 401.

---

## PATCH /api/notificacoes/{id}/read

**Body**: vazio.

**Response 200**: `{ id, is_read: true, read_at: '...' }`.

**Errors**:

- 401 / 403
- 404 — `NOTIFICATION_NOT_FOUND` (id não pertence ao usuário; RLS filtra)

---

## POST /api/notificacoes/mark-all-read

**Body**: vazio.

**Response 200**: `{ updated: N }` — quantas foram marcadas.

**Errors**: 401.

---

## Testes de contrato exigidos

| Arquivo                                                  | Cenários                                                                                                               |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `tests/contract/api-notificacoes-rbac.spec.ts`           | qualquer papel autenticado acessa; cross-user retorna apenas próprias                                                  |
| `tests/integration/notifications-generation.spec.ts`     | 4 categorias × idempotência: 2 chamadas seguidas não duplicam; conflito UNIQUE retorna `inserted:0` na segunda chamada |
| `tests/integration/notifications-mark-read-flow.spec.ts` | criar notif via RPC → GET → PATCH read → unread_count diminui; mark-all-read marca todas; histórico permanece visível  |

### Cenários específicos da geração

1. **Atendimentos hoje (admin)**: seed 2 atendimentos hoje + 1 ontem; admin recebe 2 notificações `type='atendimento'`, nenhuma do dia anterior.
2. **Atendimentos hoje (profissional vinculado)**: seed admin + doctor com user_id + 2 atendimentos hoje (1 deste doctor, 1 de outro); doctor recebe 1 notif do dele apenas; admin recebe 2.
3. **Tarefas hoje + atrasadas**: seed task com `due_date=hoje` e outra com `due_date=ontem` para o mesmo usuário; gera 1 `tarefa` + 1 `tarefa_atrasada` distintas.
4. **Aniversariantes do mês**: seed 3 pacientes com birth_date em mês corrente; gera 1 notif consolidada. Sem aniversariantes: zero notif gerada.
5. **Idempotência**: chamar a RPC 2 vezes seguidas; segunda chamada retorna `inserted_*: 0` para todos os tipos.
6. **Mês muda**: simular `CURRENT_DATE` para o próximo mês via fixed clock se possível; gera nova notif aniversariantes (mês diferente = `reference_key` diferente).

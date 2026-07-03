# Phase 1 — Data Model: Permissões granulares + autonomia de super-admin

## Entidade nova: `user_permission_overrides`

| Coluna       | Tipo          | Notas                                          |
| ------------ | ------------- | ---------------------------------------------- |
| `id`         | UUID PK       | `gen_random_uuid()`                            |
| `tenant_id`  | UUID NOT NULL | FK `tenants(id)` ON DELETE CASCADE; isolamento |
| `user_id`    | UUID NOT NULL | usuário alvo (auth.users)                      |
| `action`     | TEXT NOT NULL | uma das Actions do `rbac.ts` (validada na app) |
| `effect`     | TEXT NOT NULL | `'grant'` ou `'deny'` (CHECK)                  |
| `created_at` | TIMESTAMPTZ   | `now()`                                        |
| `created_by` | UUID          | ator que definiu                               |
| `updated_at` | TIMESTAMPTZ   | `now()` (touch trigger)                        |

- **Unique**: `(tenant_id, user_id, action)` — um efeito por (usuário, ação). Re-setar troca o efeito (upsert).
- **Índice**: `(tenant_id, user_id)` — carga por request.
- **RLS**: leitura/escrita por admin do próprio tenant (via policies por `jwt_tenant_id()` + papel admin) e `service_role` (super-admin). Mutável (config), não append-only — a trilha fica em `audit_log`.

## Permissão efetiva (lógica em `rbac.ts`)

```
efetivo(role, overrides) = ( MATRIX[role] ∪ { a | (a,grant) ∈ overrides } )
                                       \  { a | (a,deny)  ∈ overrides }
canUser(role, overrides, action) = action ∈ efetivo(role, overrides)
```

Regras:

- **deny prevalece** sobre grant e sobre o papel.
- grant de ação que o papel já tem = no-op.
- `can(role, action)` (legado) continua válido para contextos sem usuário/overrides, mas a checagem **autoritativa** usa `canUser` com overrides carregados.

## Ações: overridáveis vs protegidas

- **Protegidas (NÃO-overridáveis por padrão — Princípio V)**: `price.write`, `commission.write`, `appointment.reverse`, `audit.read`, `audit.export`. _(Sujeito à decisão do stakeholder — ver plan §Complexity Tracking.)_
- **Sensíveis (overridáveis, com AVISO na UI)**: demais ações de escrita financeira/configuração.
- **Livres (overridáveis, sem aviso)**: leituras, `task.*`, `finance.view_values`, configs não-críticas.

## Entidades existentes reusadas

- **`user_tenants`**: papel + status do usuário no tenant (já existe). Trigger `enforce_last_admin` continua protegendo o último admin.
- **`tenant_clinic_profile`**: dados cadastrais editáveis pelo super-admin (nome/CNPJ/contato).
- **`audit_log`**: registra overrides, gestão de usuário cross-tenant, reset, impersonação e negações.

## Estado: sessão de impersonação (super-admin)

```
[plataforma] --(super-admin inicia impersonação de tenant X)--> [impersonando X: READ-ONLY]
[impersonando X] --(qualquer Action de ESCRITA)--> NEGADO no servidor (+ audit)
[impersonando X] --(encerrar OU expirar)--> [plataforma]   (fim auditado)
```

Invariantes:

- Durante impersonação, o servidor **bloqueia toda escrita** no tenant alvo (independente da Action).
- Início e fim sempre auditados; banner visível enquanto ativa.

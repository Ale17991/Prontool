# Contract — `/api/impostos` & `/api/impostos/[id]`

> Cobre US1 (cadastrar/listar/editar/desativar impostos da clínica).
> Padrão de implementação: igual a `/api/planos` e `/api/despesas` (Route Handlers em `src/app/api/`, com `requireRole`, Zod, service client + RLS escope explícito).

## Rotas

| Método | Path                 | Papéis                                               | Descrição                                                   |
| ------ | -------------------- | ---------------------------------------------------- | ----------------------------------------------------------- |
| GET    | `/api/impostos`      | admin, financeiro, recepcionista, profissional_saude | Lista impostos do tenant (com filtro de status)             |
| POST   | `/api/impostos`      | admin, financeiro                                    | Cria novo imposto                                           |
| GET    | `/api/impostos/{id}` | admin, financeiro, recepcionista, profissional_saude | Detalhe de um imposto                                       |
| PATCH  | `/api/impostos/{id}` | admin, financeiro                                    | Atualiza alíquota, descrição ou status (não nome/categoria) |

`runtime = 'nodejs'`, `dynamic = 'force-dynamic'` (DB-backed).

---

## GET /api/impostos

**Query params**

```
include_inactive?: 'true' | 'false'   // default false
category?: 'municipal' | 'estadual' | 'federal' | 'outro'
```

**Response 200**

```json
[
  {
    "id": "8d2c9f04-…",
    "name": "ISS",
    "rate_bps": 500,
    "rate_percent": "5,00",
    "description": "ISS municipal de Curitiba",
    "category": "municipal",
    "is_active": true,
    "created_at": "2026-05-13T14:22:01Z"
  }
]
```

- `rate_percent` é derivado server-side (locale pt-BR) para evitar divergência client/server.
- Ordenação: `is_active DESC`, `lower(name) ASC`.
- Resultado já filtrado por `deleted_at IS NULL` (soft-delete oculto).

**Errors**: 401 (sem sessão), 403 (papel não autorizado).

---

## POST /api/impostos

**Body schema (Zod)**

```ts
const createTaxSchema = z.object({
  name: z.string().min(1).max(80),
  rate_bps: z.number().int().min(0).max(10000),
  category: z.enum(['municipal', 'estadual', 'federal', 'outro']),
  description: z.string().max(500).optional().nullable(),
})
```

**Request example**

```json
{
  "name": "ISS",
  "rate_bps": 500,
  "category": "municipal",
  "description": "ISS de Curitiba"
}
```

**Response 201**

```json
{
  "id": "8d2c9f04-…",
  "name": "ISS",
  "rate_bps": 500,
  "rate_percent": "5,00",
  "category": "municipal",
  "description": "ISS de Curitiba",
  "is_active": true,
  "created_at": "2026-05-13T14:22:01Z"
}
```

**Errors**

| Status | Code              | Quando                                           |
| ------ | ----------------- | ------------------------------------------------ |
| 400    | `INVALID_BODY`    | Zod fail (campos faltando, range inválido, etc.) |
| 401    | `UNAUTHENTICATED` | sem sessão                                       |
| 403    | `FORBIDDEN`       | papel != admin/financeiro                        |
| 409    | `TAX_DUPLICATE`   | UNIQUE INDEX violado (nome duplicado, ci, trim)  |

**Side effects**

- 1 row em `audit_log` (`entity='taxes'`, `field='created'`).

---

## PATCH /api/impostos/{id}

**Body schema (Zod) — todos opcionais; pelo menos 1 obrigatório**

```ts
const patchTaxSchema = z
  .object({
    rate_bps: z.number().int().min(0).max(10000).optional(),
    description: z.string().max(500).nullable().optional(),
    is_active: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'pelo menos um campo' })
```

**Response 200**: TaxDTO atualizado (mesmo shape do POST).

**Errors**

| Status | Code              | Quando                                             |
| ------ | ----------------- | -------------------------------------------------- |
| 400    | `INVALID_BODY`    | Zod fail / nada para atualizar                     |
| 401    | `UNAUTHENTICATED` | sem sessão                                         |
| 403    | `FORBIDDEN`       | papel != admin/financeiro                          |
| 404    | `TAX_NOT_FOUND`   | id não existe ou cross-tenant (RLS retorna 0 rows) |

**Side effects**

- 1+ rows em `audit_log` (uma por coluna mutada — `rate_bps`, `description`, `is_active`). Inferido pela trigger `audit_taxes_change`.

---

## DELETE (não suportado)

Conforme FR-006: não há endpoint DELETE físico. Para "remover" um imposto, faz-se `PATCH { "is_active": false }` (desativação reversível).

> _Reservado para futura evolução_: pode-se opcionalmente expor `DELETE /api/impostos/{id}` que faça `UPDATE taxes SET deleted_at=now()` (soft-delete definitivo) caso a UI precise distinguir "desativado temporariamente" de "removido em definitivo". Fora do escopo desta feature.

---

## Testes de contrato exigidos

| Arquivo                                                | Cenários                                                                                |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `tests/contract/api-impostos-rbac.test.ts`             | 4 papéis × 3 ações (GET, POST, PATCH) → esperar 200/201/403/403 conforme matriz         |
| `tests/contract/api-impostos-tenant-isolation.test.ts` | session=tenantA tenta GET/PATCH em row de tenantB → 404                                 |
| `tests/contract/taxes-immutability.test.ts`            | (SQL) tenta `UPDATE taxes SET name='X'` → exception                                     |
| `tests/contract/api-impostos-validation.test.ts`       | Zod boundary cases (rate_bps -1, 10001, 99.9; name 0-char e 81-char; category inválida) |
| `tests/contract/api-impostos-duplicate.test.ts`        | criar "ISS" + criar " iss " (trim+ci) → 409                                             |

---

## Notas de implementação

- `createTax` em `src/lib/core/taxes/create.ts` traduz `error.code === '23505'` para `ConflictError('TAX_DUPLICATE', ...)` (padrão existente em `createHealthPlan`).
- Como o trigger imutável bloqueia tentativa de mudar `name`/`category`, a rota PATCH apenas omite esses campos do schema (defense-in-depth — Zod + DB).
- Resposta inclui `rate_percent` formatado em pt-BR (`6,50`) usando o helper `bpsToPercent` — UI apenas exibe.

# Contract — `POST /api/despesas` (extensão: `tax_id`)

> Cobre US3 (vincular despesa a imposto cadastrado). Estende `src/app/api/despesas/route.ts` sem quebrar contrato atual.

## Mudança

Adiciona `tax_id?: string | null` ao body schema do `POST /api/despesas`. Quando informado:

- O servidor força `category = 'impostos'` (sobrescreve se vier diferente; loga warn).
- Valida que `tax_id` referencia um imposto **ativo** do mesmo tenant.

### Body schema (Zod, estendido)

```ts
const createSchema = z.object({
  category: z.enum([
    'aluguel',
    'equipamentos',
    'materiais',
    'pessoal',
    'servicos',
    'impostos',
    'manutencao',
    'outros',
  ]),
  description: z.string().min(2).max(500),
  supplier: z.string().max(200).optional().nullable(),
  amount_cents: z.number().int().positive(),
  competence_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  recurring: z.boolean().default(false),
  frequency: z.enum(['mensal', 'semanal', 'anual']).optional().nullable(),

  // NOVO:
  tax_id: z.string().uuid().nullable().optional(),
})
```

### Regra de normalização

Pseudo-código do handler:

```ts
const parsed = createSchema.parse(body)
if (parsed.tax_id) {
  // valida que existe + ativo + mesmo tenant (defense-in-depth)
  const tax = await fetchActiveTax(supabase, { tenantId, id: parsed.tax_id })
  if (!tax) throw new ValidationError('TAX_NOT_FOUND_OR_INACTIVE', '...')
  parsed.category = 'impostos'   // força (FR-015)
}
const expense = await createExpense(supabase, { ..., taxId: parsed.tax_id ?? null })
```

### Request example

```json
{
  "category": "impostos",
  "description": "ISS Curitiba — abr/2026",
  "amount_cents": 12500,
  "competence_date": "2026-05-01",
  "tax_id": "8d2c9f04-…"
}
```

### Response 201

```json
{
  "id": "…",
  "category": "impostos",
  "description": "ISS Curitiba — abr/2026",
  "amount_cents": 12500,
  "competence_date": "2026-05-01",
  "tax_id": "8d2c9f04-…",
  "tax_name": "ISS",
  "created_at": "…"
}
```

`tax_name` é projetado pelo handler (join leve em `taxes`) para a UI exibir sem segunda chamada.

### Errors

| Status | Code                        | Quando                                                                                   |
| ------ | --------------------------- | ---------------------------------------------------------------------------------------- |
| 400    | `INVALID_BODY`              | Zod fail                                                                                 |
| 400    | `TAX_NOT_FOUND_OR_INACTIVE` | tax_id não existe ou está inativo/deletado                                               |
| 400    | `CHECK_VIOLATION`           | (defensivo) DB CHECK falhou — não deveria acontecer porque a app força category=impostos |
| 401    | `UNAUTHENTICATED`           | sem sessão                                                                               |
| 403    | `FORBIDDEN`                 | papel != admin/financeiro                                                                |

---

## GET /api/despesas (extensão)

Resposta agora inclui `tax_id` e `tax_name` quando houver vínculo:

```json
{
  "id": "…",
  "category": "impostos",
  "description": "ISS abr/2026",
  "tax_id": "8d2c9f04-…",
  "tax_name": "ISS",
  ...
}
```

Filtro por categoria já existente continua valendo: `?category=impostos` lista todas as despesas categorizadas como imposto (com ou sem `tax_id` vinculado — algumas podem ser lançamentos manuais antigos sem vínculo).

---

## Testes de contrato exigidos

| Arquivo                                                 | Cenários                                                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `tests/contract/expenses-tax-link-category.test.ts`     | POST com tax_id e category='aluguel' ⇒ servidor força impostos (200, category normalizada) |
| `tests/contract/expenses-tax-link-validation.test.ts`   | tax_id inválido (uuid inexistente) ⇒ 400 `TAX_NOT_FOUND_OR_INACTIVE`                       |
| `tests/contract/expenses-tax-link-inactive.test.ts`     | tax_id de imposto desativado ⇒ 400                                                         |
| `tests/contract/expenses-tax-link-cross-tenant.test.ts` | tax_id de outro tenant ⇒ 400 (RLS bloqueia leitura → caem em not-found)                    |
| `tests/contract/expenses-tax-link-db-check.test.ts`     | (SQL) `INSERT expenses SET tax_id=X, category='aluguel'` ⇒ CHECK violation                 |
| `tests/contract/expenses-tax-link-immutability.test.ts` | UPDATE expenses SET tax_id=Y ⇒ exception (trigger)                                         |

---

## Notas de implementação

- `createExpense` em `src/lib/core/expenses/create.ts` ganha parâmetro `taxId?: string | null`. Se preenchido, força category=impostos (defense-in-depth).
- `listExpenses` em `src/lib/core/expenses/list.ts` faz `.select('..., tax:tax_id(id, name)')` quando houver `tax_id`. Custo: query plan já indexa por `(tenant_id, tax_id)` e o join é leve.
- UI (`new-expense-form.tsx`) carrega lista de impostos ativos uma vez via `GET /api/impostos?include_inactive=false`. Cache local enquanto o form estiver aberto.

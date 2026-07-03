# Contract — `PATCH /api/planos/{id}` (extensão: `tax_rate_bps`)

> Cobre US2 (alíquota do convênio). Estende a rota existente (`src/app/api/planos/[id]/route.ts`) sem quebrar contrato atual (`active` continua funcionando).

## Mudança

A rota `PATCH /api/planos/{id}` hoje aceita apenas `{ active: boolean }`. A feature acrescenta `tax_rate_bps?: number` no payload.

### Body schema (Zod, estendido)

```ts
const patchPlanSchema = z
  .object({
    active: z.boolean().optional(),
    tax_rate_bps: z.number().int().min(0).max(10000).optional(),
  })
  .refine((d) => d.active !== undefined || d.tax_rate_bps !== undefined, {
    message: 'pelo menos um campo (active ou tax_rate_bps)',
  })
```

### Request examples

```json
// caso clássico (não muda)
{ "active": false }

// novo: ativar imposto do convênio
{ "tax_rate_bps": 650 }

// novo: desativar imposto do convênio (checkbox desmarcado na UI)
{ "tax_rate_bps": 0 }

// combinado
{ "active": true, "tax_rate_bps": 800 }
```

### Response 200

```json
{
  "id": "…",
  "name": "Unimed",
  "active": true,
  "tax_rate_bps": 650,
  "tax_rate_percent": "6,50",
  "created_at": "…"
}
```

### Errors

| Status | Code              | Quando                                                |
| ------ | ----------------- | ----------------------------------------------------- |
| 400    | `INVALID_BODY`    | Zod fail (range inválido, payload vazio)              |
| 401    | `UNAUTHENTICATED` | sem sessão                                            |
| 403    | `FORBIDDEN`       | papel != admin (mantém regra atual de `health_plans`) |
| 404    | `PLAN_NOT_FOUND`  | id inexistente / cross-tenant (RLS)                   |

### Side effects

- Mudança em `tax_rate_bps`: 1 row em `audit_log` via `audit_health_plan_tax_rate_change`.
- Mudança em `active`: já é coberta pelo audit existente (sem regressão).

---

## GET /api/planos (e GET /api/planos/{id})

`tax_rate_bps` passa a ser incluído no DTO de leitura (sem nova rota). Existing consumers que não conhecem o campo simplesmente o ignoram (backward-compatible).

```json
{
  "id": "…",
  "name": "Unimed",
  "active": true,
  "tax_rate_bps": 650,
  "tax_rate_percent": "6,50",
  "created_at": "…"
}
```

---

## POST /api/planos (criação)

Spec FR-009 (US2 Scenario 4) exige que o **checkbox venha desmarcado por padrão na criação**. Como `tax_rate_bps` tem `DEFAULT 0` no schema, basta a UI **não enviar** o campo no payload — o servidor não precisa aceitá-lo na criação para isto funcionar. Para reduzir surface (princípio do menor privilégio em API), **não aceitar `tax_rate_bps` no POST**: o usuário cria o convênio e edita a alíquota num passo separado se quiser. Isso simplifica audit (não há linha "criou já com alíquota X") e mantém consistência com o fluxo atual (criação mínima → edit posterior).

Decisão: `POST /api/planos` continua aceitando apenas `{ name }`. UI da criação **pode** mostrar a checkbox e o campo, mas só fará `PATCH` após o POST inicial.

> _Alternativa rejeitada_: aceitar `tax_rate_bps` no POST. Pequena ergonomia ganha não justifica a divergência de fluxo entre criação e edição.

---

## Testes de contrato exigidos

| Arquivo                                                 | Cenários                                                                    |
| ------------------------------------------------------- | --------------------------------------------------------------------------- |
| `tests/contract/api-planos-tax-rate-rbac.test.ts`       | financeiro/recepcionista/profissional_saude → PATCH `tax_rate_bps` ⇒ 403    |
| `tests/contract/api-planos-tax-rate-validation.test.ts` | `-1`, `10001`, `'abc'`, `null` ⇒ 400                                        |
| `tests/contract/api-planos-tax-rate-audit.test.ts`      | PATCH 0→650 ⇒ 1 row em `audit_log` (`field='tax_rate_bps'`, old=0, new=650) |
| `tests/contract/api-planos-tax-rate-tenant.test.ts`     | tenantA PATCH plan-de-tenantB ⇒ 404                                         |

---

## Notas de implementação

- `updatePlanTaxRate(supabase, { tenantId, planId, taxRateBps })` em `src/lib/core/plans/update-tax-rate.ts`.
- Route handler une `update-active` e `update-tax-rate` em uma chamada quando ambos campos vêm; consulta `health_plans` 1x ao final para devolver o estado consolidado.
- Conversão `taxRatePercent` formatada por `bpsToPercent`, server-side.

# Phase 1 — HTTP API Contracts

**Feature**: 023 — Financeiro robusto
**Date**: 2026-05-20

## Convenções globais

- Todos os endpoints sob `/api/financeiro/**` requerem auth via `requireRole(...)`.
- Tenant isolation: `tenant_id` derivado de `session.tenantId` (cookie); nunca aceito em body/query.
- Cents: todos os valores em `int64` (BigInt em TS; serializado como número JSON).
- Datas: ISO 8601 UTC para timestamps; `YYYY-MM-DD` para datas puras.
- Erros: padrão `{ error: 'CODE', message: 'desc' }` com status apropriado.
- Audit: cada mutação chama `log_audit_event` antes de retornar.

---

## 1. Contas a Receber

### `GET /api/financeiro/contas-a-receber`

**Auth**: `admin | financeiro | recepcionista`
**Query params**:

- `from?` — DATE, default hoje-7
- `to?` — DATE, default hoje+30
- `status?` — `pendente | atrasado | parcial | inadimplencia | all` (default `all`)
- `plan_id?` — UUID filtra por plano de saúde
- `patient_id?` — UUID filtra por paciente
- `limit?` — int (default 100, max 500)

**Response 200**:

```json
{
  "installments": [
    {
      "id": "uuid",
      "patient": { "id": "uuid", "fullName": "Maria T.", "isAnonymized": false },
      "plan": { "id": "uuid", "name": "Unimed" } | null,
      "due_date": "2026-05-25",
      "amount_cents": 60000,
      "paid_amount_cents": 20000,
      "pending_amount_cents": 40000,
      "status": "parcial",
      "days_overdue": 0,
      "payments_count": 1
    }
  ],
  "summary": {
    "total_pending_cents": 250000,
    "count_overdue": 3,
    "count_critical": 1
  }
}
```

### `POST /api/financeiro/contas-a-receber/[installmentId]/payment`

**Auth**: `admin | financeiro | recepcionista`
**Body** (Zod):

```json
{
  "amount_cents": 20000,
  "payment_method": "pix",
  "paid_at": "2026-05-20T14:30:00Z",
  "note": "opcional"
}
```

**Validações**:

- `amount_cents > 0` e `amount_cents <= pending_amount_cents` da parcela.
- `installment.tenant_id = session.tenantId` (RLS + check explícito).
- `payment_method` ∈ lista de métodos válidos (text livre por enquanto).

**Response 201**:

```json
{ "payment_id": "uuid", "new_pending_cents": 20000, "new_status": "parcial" }
```

**Side-effects**:

- INSERT em `installment_payments`.
- Trigger atualiza `payment_installments.paid_amount_cents`, `paid_at`, `status`.
- Audit `installment.payment_recorded`.

### `POST /api/financeiro/contas-a-receber/[installmentId]/bad-debt`

**Auth**: `admin | financeiro`
**Body**:

```json
{ "reason": "opcional, mínimo 10 chars se preenchido" }
```

**Pré-condição**: parcela com `days_overdue > 60` ou flag de override por admin.
**Side-effect**: atualiza `payment_installments.status = 'inadimplencia'`; audit log.

### `POST /api/financeiro/contas-a-receber/[installmentId]/reverse-payment`

**Auth**: `admin` apenas
**Body**:

```json
{
  "payment_id": "uuid",
  "reason": "obrigatório, ≥10 chars"
}
```

**Side-effect**: INSERT em `installment_payments` com `amount_cents` negativo do pagamento original; `note` = "Estorno: " + reason. Trigger recalcula cache.

---

## 2. Contas a Pagar

### `GET /api/financeiro/contas-a-pagar`

**Auth**: `admin | financeiro`
**Query params**:

- `from?`, `to?` — DATE (default mês atual)
- `category?` — uma das categorias existentes
- `supplier?` — text contains (case-insensitive)
- `status?` — `a_vencer | vencida | paga | all`
- `include_projections?` — bool (default true)

**Response 200**:

```json
{
  "expenses": [
    {
      "id": "uuid",
      "description": "Aluguel maio/2026",
      "category": "aluguel",
      "supplier": "Imobiliária X",
      "amount_cents": 500000,
      "competence_date": "2026-05-05",
      "status": "paga",
      "paid_at": "2026-05-03T10:00:00Z",
      "paid_amount_cents": 500000,
      "is_projection": false,
      "is_superseded": false,
      "recurring": true,
      "recurring_starts_at": "2026-01-01",
      "recurring_ends_at": null,
      "superseded_by_id": null
    },
    {
      "id": "projection-uuid-2026-06-05",
      "parent_id": "uuid",
      "description": "Aluguel (projeção jun/2026)",
      "category": "aluguel",
      "supplier": "Imobiliária X",
      "amount_cents": 500000,
      "competence_date": "2026-06-05",
      "status": "a_vencer",
      "is_projection": true
    }
  ],
  "summary": {
    "total_pending_cents": 1500000,
    "by_category": { "aluguel": 1000000, "materiais": 500000 }
  }
}
```

### `POST /api/financeiro/contas-a-pagar/[expenseId]/pay`

**Auth**: `admin | financeiro`
**Body**:

```json
{
  "paid_at": "2026-05-20T10:00:00Z",
  "paid_amount_cents": 500000,
  "payment_method": "boleto"
}
```

**Validações**: `expense.paid_at IS NULL`; `paid_amount_cents > 0`.
**Side-effect**: UPDATE em `expenses` (apenas colunas de pagamento — Princípio I respeita); audit log.

### `POST /api/financeiro/contas-a-pagar/[expenseId]/version`

**Auth**: `admin | financeiro`
**Body**:

```json
{
  "effective_from": "2026-06-01",
  "new_amount_cents": 550000,
  "reason": "Reajuste anual contratual"
}
```

**Comportamento (FR-014a)**:

1. UPDATE `expenses` antiga: `recurring_ends_at = effective_from - 1 day`.
2. INSERT nova `expenses` com mesmos campos exceto `amount_cents = new_amount_cents`, `recurring_starts_at = effective_from`, `competence_date = effective_from`.
3. UPDATE `superseded_by = new_id` na antiga.
4. Audit `expense.recurring.versioned`.

**Response 201**: `{ new_expense_id, old_expense_id, effective_from }`

### `POST /api/financeiro/contas-a-pagar/[expenseId]/end-recurring`

**Auth**: `admin | financeiro`
**Body**: `{ "ends_at": "2026-08-31" }`
**Side-effect**: UPDATE `expenses.recurring_ends_at` SEM criar versão; `superseded_by` permanece NULL. Audit.

---

## 3. Fluxo de Caixa

### `GET /api/financeiro/fluxo-caixa`

**Auth**: `admin | financeiro`
**Query params**:

- `from` — DATE (required)
- `to` — DATE (required)
- `scale?` — `daily | weekly | monthly` (default `daily` se range ≤30d, `weekly` se ≤90d, `monthly` >90d)

**Response 200**:

```json
{
  "starting_balance_cents": 1000000,
  "events": [
    {
      "date": "2026-05-20",
      "type": "entry",
      "description": "Pagamento parcela #abc - Maria T.",
      "amount_cents": 20000,
      "source": "installment",
      "source_id": "uuid"
    },
    {
      "date": "2026-05-25",
      "type": "exit",
      "description": "Aluguel maio/2026",
      "amount_cents": -500000,
      "source": "expense",
      "source_id": "uuid",
      "is_projection": false
    }
  ],
  "aggregated": {
    "scale": "daily",
    "buckets": [
      {
        "key": "2026-05-20",
        "entries_cents": 50000,
        "exits_cents": -20000,
        "delta_cents": 30000,
        "balance_after_cents": 1030000
      }
    ]
  }
}
```

---

## 4. Repasse Médico

### `GET /api/financeiro/repasse-medico/[mes]`

`mes` formato `YYYY-MM`.
**Auth**: `admin | financeiro | profissional_saude`
**Response (admin/financeiro)**:

```json
{
  "month": "2026-04",
  "status": "fechado",
  "closed_at": "2026-05-02T10:00:00Z",
  "closed_by_user_id": "uuid",
  "payouts": [
    {
      "doctor_id": "uuid",
      "doctor_name": "Dr. José",
      "gross_revenue_cents": 1200000,
      "commission_cents": 720000,
      "fixed_payment_cents": 0,
      "liberal_payment_cents": 0,
      "adjustments_cents": -20000,
      "total_due_cents": 700000,
      "paid_at": null,
      "paid_amount_cents": null
    }
  ],
  "total_due_cents": 2100000,
  "can_reopen": true
}
```

**Response (profissional_saude)**: idem mas `payouts` filtrado server-side para apenas o próprio `doctor.user_id`. `appointments_detail` adicional com cada atendimento e sua comissão calculada (FR-036).

### `POST /api/financeiro/repasse-medico/[mes]/close`

**Auth**: `admin` apenas
**Body**: `{ "confirm": true }`
**Side-effect**: chama `close_monthly_payout(tenant_id, mes)` SECURITY DEFINER. INSERT em `monthly_payouts` por médico; UPDATE `closed_at = now()`.

### `POST /api/financeiro/repasse-medico/[mes]/reopen`

**Auth**: `admin` apenas
**Body**: `{ "reason": "≥20 chars" }`
**Pré-condições verificadas pela função DB**: 24h + sem `paid_at` (FR-032a).
**Side-effect**: snapshot em `monthly_payouts_reopens` + UPDATE `monthly_payouts` zerando `closed_at`.

### `POST /api/financeiro/repasse-medico/[mes]/payouts/[payoutId]/mark-paid`

**Auth**: `admin | financeiro`
**Body**:

```json
{
  "paid_at": "2026-05-10T12:00:00Z",
  "paid_amount_cents": 700000,
  "payment_method": "ted",
  "payment_note": "TED ref 123456"
}
```

**Side-effect**: UPDATE `monthly_payouts` campos de pagamento. Audit.

---

## 5. Saldo de Caixa do Tenant

### `GET /api/configuracoes/cash-balance`

**Auth**: `admin | financeiro`
**Response**:

```json
{
  "current_balance_cents": 1500000,
  "as_of": "2026-05-20",
  "history": [
    {
      "id": "uuid",
      "effective_from": "2026-05-01",
      "amount_cents": 500000,
      "reason": "Aporte do sócio",
      "actor_user_id": "uuid",
      "created_at": "2026-05-01T09:00:00Z"
    }
  ]
}
```

### `POST /api/configuracoes/cash-balance`

**Auth**: `admin` apenas
**Body**:

```json
{
  "effective_from": "2026-05-20",
  "amount_cents": 100000,
  "reason": "Aporte adicional do sócio"
}
```

**Validações**: `reason.length >= 3`; `amount_cents != 0`.
**Side-effect**: INSERT em `tenant_cash_balance_adjustments`. Audit.

---

## Mapeamento FR → Endpoint

| FR                                 | Endpoint                                                              |
| ---------------------------------- | --------------------------------------------------------------------- | --------------------------------- |
| FR-001/002/003/004                 | `GET /financeiro/contas-a-receber`                                    |
| FR-005                             | `POST /contas-a-receber/[id]/payment`                                 |
| FR-006/007                         | `POST /contas-a-receber/[id]/bad-debt`                                |
| FR-008                             | `POST /contas-a-receber/[id]/reverse-payment`                         |
| FR-009/010/011/012/013/015         | `GET /financeiro/contas-a-pagar`                                      |
| FR-014a                            | `POST /contas-a-pagar/[id]/version`                                   |
| FR-014b                            | `POST /contas-a-pagar/[id]/end-recurring`                             |
| FR-016/017/018                     | `POST /contas-a-pagar/[id]/pay` (+ admin reverse)                     |
| FR-019/020/021/022/023/024/025/026 | `GET /financeiro/fluxo-caixa`                                         |
| FR-021/21a/21b                     | `GET                                                                  | POST /configuracoes/cash-balance` |
| FR-027/028/029/030/035/036         | `GET /repasse-medico/[mes]`                                           |
| FR-031                             | `POST /repasse-medico/[mes]/close`                                    |
| FR-032/32a/32b                     | `POST /repasse-medico/[mes]/reopen`                                   |
| FR-033/037                         | `POST /repasse-medico/[mes]/payouts/[id]/mark-paid`                   |
| FR-034                             | trigger DB `generate_payout_adjustment_if_closed` (sem endpoint)      |
| FR-042/43/44                       | helper SQL `log_audit_event` + triggers `enforce_append_only_columns` |
| FR-045                             | renderização condicional client + server check                        |
| FR-046                             | RLS de `monthly_payouts`                                              |

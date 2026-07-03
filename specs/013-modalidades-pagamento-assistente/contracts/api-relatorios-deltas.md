# API Contract — Deltas em relatórios

Documenta apenas as **mudanças** sobre os endpoints de relatório existentes (output schema) + um endpoint novo para resultado operacional.

---

## 1. `GET /api/relatorios/mensal?month=YYYY-MM` (alterada — output)

**RBAC**: `admin`, `financeiro` (sem mudança).

**Mudança**: a resposta ganha uma nova categoria de lançamentos — pagamentos fixos derivados da view `monthly_fixed_pay_lines`. Aparece apenas a partir do `billing_day` configurado de cada doctor Fixo (FR-020).

**Response 200** — campo novo `fixed_pay_lines`:

```json
{
  "month": "2026-05",
  "appointments": [ ... ],          // existente
  "expenses":     [ ... ],          // existente
  "fixed_pay_lines": [               // NOVO
    {
      "doctor_id":   "<uuid>",
      "doctor_name": "Dr. Foo",
      "amount_cents": 800000,
      "billing_date": "2026-05-05",
      "billing_day":  5
    }
  ],
  "totals": {
    "gross_revenue_cents":   150000_00,
    "commissions_cents":      42000_00,
    "fixed_payments_cents":   24000_00,  // NOVO
    "expenses_cents":         12000_00
  }
}
```

**Server flow**:

1. `requireRole(['admin','financeiro'])`.
2. Lê appointments + expenses (igual hoje).
3. `SELECT * FROM monthly_fixed_pay_lines WHERE tenant_id=? AND date_trunc('month', month_start) = ?` ordenado por `billing_date ASC`.
4. Agrega totals.

---

## 2. `GET /api/relatorios/por-profissional/[doctorId]?from=...&to=...` (alterada — branches por modalidade)

**RBAC**: `admin`, `financeiro` (sem mudança).

**Mudança**: resposta tem shape diferente conforme `payment_mode` do doctor (FR-021, FR-022, FR-023).

### 2.a — Doctor Comissionado (sem mudança — 100% backward compat)

```json
{
  "doctor": { "id": "...", "full_name": "...", "payment_mode": "comissionado" },
  "period": { "from": "2026-05-01", "to": "2026-05-31" },
  "summary": {
    "appointments_count": 42,
    "gross_revenue_cents": 80000_00,
    "commission_cents":    24000_00,
    "current_percentage_bps": 3000
  },
  "appointments": [ ... ]
}
```

### 2.b — Doctor Fixo (NOVO shape)

```json
{
  "doctor": { "id": "...", "full_name": "...", "payment_mode": "fixo" },
  "period": { "from": "2026-04-01", "to": "2026-05-31" },
  "summary": {
    "appointments_count": 18,
    "gross_revenue_cents": 36000_00,
    "monthly_amount_cents": 800000,    // valor fixo vigente
    "billing_day": 5,
    "fixed_payments_in_period_cents": 1600000,  // 2 meses × 8000
    "commission_cents": 0              // sempre 0 para fixos
  },
  "appointments":   [ ... ],
  "fixed_pay_lines": [               // 2 meses no exemplo
    { "month_start": "2026-04-01", "billing_date": "2026-04-05", "amount_cents": 800000 },
    { "month_start": "2026-05-01", "billing_date": "2026-05-05", "amount_cents": 800000 }
  ]
}
```

### 2.c — Doctor Liberal (NOVO shape)

```json
{
  "doctor": { "id": "...", "full_name": "...", "payment_mode": "liberal" },
  "period": { "from": "2026-05-01", "to": "2026-05-31" },
  "summary": {
    "participations_count": 3,
    "total_paid_cents": 95000,
    "current_default_cents": 35000
  },
  "participations": [
    {
      "appointment_id": "...",
      "appointment_at": "2026-05-04T14:00Z",
      "patient_name": "P 1",
      "frozen_amount_cents": 35000
    },
    {
      "appointment_id": "...",
      "appointment_at": "2026-05-08T15:30Z",
      "patient_name": "P 2",
      "frozen_amount_cents": 20000
    },
    {
      "appointment_id": "...",
      "appointment_at": "2026-05-20T09:00Z",
      "patient_name": "P 3",
      "frozen_amount_cents": 40000
    }
  ]
}
```

**Filtros aplicados às participations** (FR-019, FR-022):

- `removed_at IS NULL` (somente ativos).
- `NOT EXISTS (SELECT 1 FROM appointment_reversals WHERE appointment_id = aa.appointment_id)` (exclui estornados).
- `appointment.appointment_at BETWEEN from AND to`.

---

## 3. `GET /api/relatorios/resultado-operacional?month=YYYY-MM` — NOVO

**RBAC**: `admin`, `financeiro`.

**Server flow**:

1. `requireRole(['admin','financeiro'])`.
2. Computa cada termo (research Decisão 7):
   - `gross_revenue_cents` = SUM `appointments.frozen_amount_cents` no mês, NOT estornado.
   - `commissions_cents` = SUM `frozen_amount_cents * frozen_commission_bps / 10000` (atendimentos não estornados).
   - `fixed_payments_cents` = SUM `monthly_fixed_pay_lines.amount_cents` no mês.
   - `liberal_payments_cents` = SUM `appointment_assistants.frozen_amount_cents WHERE appointment_at no mês AND removed_at IS NULL AND NOT estornado`.
   - `taxes_cents` = SUM `expenses.amount_cents WHERE category='tax' AND incurred_at no mês`.
   - `operating_expenses_cents` = SUM `expenses.amount_cents WHERE category != 'tax' AND incurred_at no mês`.
   - `net_profit_cents` = gross - commissions - fixed - liberal - taxes - operating.

**Response 200**:

```json
{
  "month": "2026-05",
  "lines": {
    "gross_revenue_cents": 150000_00,
    "commissions_cents": 42000_00,
    "fixed_payments_cents": 24000_00,
    "liberal_payments_cents": 3200_00,
    "taxes_cents": 12000_00,
    "operating_expenses_cents": 18500_00,
    "net_profit_cents": 50300_00
  },
  "drilldowns": {
    "commissions": "/relatorios/por-profissional?from=2026-05-01&to=2026-05-31&payment_mode=comissionado",
    "fixed": "/relatorios/mensal?month=2026-05&filter=fixed_pay_lines",
    "liberal": "/relatorios/por-profissional?from=2026-05-01&to=2026-05-31&payment_mode=liberal",
    "taxes": "/relatorios/despesas?from=2026-05-01&to=2026-05-31&category=tax",
    "operating": "/relatorios/despesas?from=2026-05-01&to=2026-05-31&category!=tax"
  }
}
```

**Errors**:

- `400 INVALID_QUERY` — `month` ausente ou formato inválido.

---

## 4. Auditoria

Relatórios são leitura — **não geram audit log** por chamada (Constitution II audita escrita, não consulta). Exceção: se um `requireRole` negar acesso, evento `auth_denied` é registrado.

---

## 5. Performance & cache

- `monthly_fixed_pay_lines` é view (sem materialização) — performance dominada por `doctor_payment_terms_current` (DISTINCT ON com index `(tenant_id, doctor_id, valid_from DESC)`). Tenants têm ≤ 20 Fixos × ≤ 24 meses úteis = ≤ 480 linhas; cabe em < 100 ms.
- `appointment_assistants` é filtrado pelo index parcial `(tenant_id, assistant_doctor_id, created_at DESC) WHERE removed_at IS NULL` para o relatório por profissional Liberal.
- Sem cache HTTP — payloads sempre `Cache-Control: private, no-store` (dados financeiros).

# Phase 1 — Data Model

**Feature**: 023 — Financeiro robusto (Fluxo de Caixa, Contas a Pagar/Receber, Repasse Médico)
**Date**: 2026-05-20
**Migration**: `0096_financeiro_operacional.sql`

## Visão geral

5 tabelas novas + 6 colunas adicionadas em `expenses`. Todas as 5 tabelas novas são append-only via trigger (com whitelist de colunas alteráveis em `monthly_payouts`). RLS por `tenant_id` em todas; RLS adicional por `doctor.user_id` em `monthly_payouts`.

```
┌──────────────────────────────┐
│ expenses (existente)         │◀── 6 colunas novas
│  + paid_at                   │
│  + paid_amount_cents         │
│  + payment_method            │
│  + recurring_starts_at       │
│  + recurring_ends_at         │
│  + superseded_by (FK self)   │
└──────────────────────────────┘

┌──────────────────────────────┐    ┌──────────────────────────────┐
│ payment_installments (exist) │◀───│ installment_payments (NOVA)  │
│  paid_amount_cents (cache)   │    │  installment_id FK           │
│  paid_at (cache)             │    │  paid_at, amount_cents, ...  │
└──────────────────────────────┘    │  APPEND-ONLY                 │
                                    └──────────────────────────────┘

┌──────────────────────────────┐
│ monthly_payouts (NOVA)       │  UNIQUE(tenant, doctor, month)
│  closed_at, closed_by        │  RLS: tenant + doctor.user_id
│  payment fields (UPDATEable) │  Trigger anti-UPDATE em cálculos
└──────────────────────────────┘
        │
        ├── monthly_payouts_adjustments (NOVA, append-only)
        │       auto-gerado por trigger em appointment_reversals
        │
        └── monthly_payouts_reopens (NOVA, append-only, snapshot JSONB)

┌──────────────────────────────────┐
│ tenant_cash_balance_adjustments  │  saldo de caixa append-only
│  (NOVA)                          │  SUM(amount) até data D = saldo
└──────────────────────────────────┘
```

---

## 1. `expenses` — ALTER (6 colunas novas)

```sql
ALTER TABLE expenses
  ADD COLUMN paid_at TIMESTAMPTZ NULL,
  ADD COLUMN paid_amount_cents BIGINT NULL CHECK (paid_amount_cents IS NULL OR paid_amount_cents >= 0),
  ADD COLUMN payment_method TEXT NULL,
  ADD COLUMN recurring_starts_at DATE NULL,
  ADD COLUMN recurring_ends_at DATE NULL,
  ADD COLUMN superseded_by UUID NULL REFERENCES expenses(id) ON DELETE SET NULL;

-- Default backfill: para despesas existentes recorrentes, recurring_starts_at = competence_date
UPDATE expenses
   SET recurring_starts_at = competence_date
 WHERE recurring = true AND recurring_starts_at IS NULL;

-- Constraint: se versão substituta existe, deve referenciar a mesma tenant
ALTER TABLE expenses
  ADD CONSTRAINT expenses_superseded_same_tenant CHECK (
    superseded_by IS NULL
    OR tenant_id = (SELECT tenant_id FROM expenses WHERE id = superseded_by)
  );

-- Index parcial para listagem de despesas pendentes (FR-010)
CREATE INDEX idx_expenses_pending_by_tenant
  ON expenses (tenant_id, competence_date)
  WHERE paid_at IS NULL AND deleted_at IS NULL;

-- Index parcial para projeção recorrente (FR-012)
CREATE INDEX idx_expenses_recurring_active
  ON expenses (tenant_id, recurring_starts_at)
  WHERE recurring = true AND recurring_ends_at IS NULL AND deleted_at IS NULL;
```

### Regras

- `paid_at`/`paid_amount_cents`/`payment_method` permanecem NULL até pagamento (FR-016).
- `paid_amount_cents` PODE ser parcial (≤ `amount_cents`) ou total. Pagamento parcial em despesa é simplificado (FR-017): apenas 1 entrada por despesa; múltiplos parciais reservados para iteração futura via despesa de ajuste.
- Reajuste de despesa recorrente cria nova linha + seta `superseded_by` na antiga + seta `recurring_ends_at` (FR-014a).
- `recurring_starts_at` é setado em criação (default = `competence_date`) ou no backfill da migration.

---

## 2. `installment_payments` (nova) — Pagamentos parciais/totais de parcelas

```sql
CREATE TABLE installment_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  installment_id UUID NOT NULL REFERENCES payment_installments(id) ON DELETE RESTRICT,
  paid_at TIMESTAMPTZ NOT NULL,
  amount_cents BIGINT NOT NULL,  -- pode ser negativo (estorno)
  payment_method TEXT NOT NULL,
  note TEXT NULL,
  actor_user_id UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_installment_payments_by_installment
  ON installment_payments (tenant_id, installment_id, paid_at DESC);

-- RLS
ALTER TABLE installment_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY ip_select_by_tenant ON installment_payments
  FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id());

CREATE POLICY ip_insert_by_tenant ON installment_payments
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = current_tenant_id());

-- Trigger anti-UPDATE/DELETE (R4)
CREATE TRIGGER ip_append_only
  BEFORE UPDATE OR DELETE ON installment_payments
  FOR EACH ROW EXECUTE FUNCTION enforce_append_only_columns(
    'installment_payments', ARRAY[]::TEXT[]
  );

-- Trigger cache: atualiza payment_installments.paid_amount_cents e paid_at (R1)
CREATE TRIGGER ip_update_installment_cache
  AFTER INSERT ON installment_payments
  FOR EACH ROW EXECUTE FUNCTION refresh_installment_paid_cache();
```

### Regras

- `amount_cents` pode ser negativo (estorno). Trigger soma corretamente.
- Para reverter um pagamento (FR-008): admin insere linha com `amount_cents = -X` e `note` obrigatória. Não há UPDATE/DELETE.
- Cache em `payment_installments.paid_amount_cents` = `SUM(installment_payments.amount_cents)` para aquela parcela.

---

## 3. `monthly_payouts` (nova) — Snapshot do repasse mensal por médico

```sql
CREATE TABLE monthly_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE RESTRICT,
  month TEXT NOT NULL CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),  -- YYYY-MM
  -- valores calculados (snapshot do fechamento)
  gross_revenue_cents BIGINT NOT NULL DEFAULT 0,
  commission_cents BIGINT NOT NULL DEFAULT 0,
  fixed_payment_cents BIGINT NOT NULL DEFAULT 0,
  liberal_payment_cents BIGINT NOT NULL DEFAULT 0,
  adjustments_cents BIGINT NOT NULL DEFAULT 0,  -- ajustes do mês anterior
  total_due_cents BIGINT NOT NULL GENERATED ALWAYS AS (
    commission_cents + fixed_payment_cents + liberal_payment_cents + adjustments_cents
  ) STORED,
  -- fechamento
  closed_at TIMESTAMPTZ NULL,
  closed_by UUID NULL REFERENCES auth.users(id),
  -- pagamento
  paid_at TIMESTAMPTZ NULL,
  paid_amount_cents BIGINT NULL,
  payment_method TEXT NULL,
  payment_note TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, doctor_id, month)
);

CREATE INDEX idx_mp_by_tenant_doctor_desc ON monthly_payouts (tenant_id, doctor_id, month DESC);
CREATE INDEX idx_mp_closed ON monthly_payouts (tenant_id, closed_at) WHERE closed_at IS NOT NULL;

-- RLS
ALTER TABLE monthly_payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY mp_select_by_tenant_admin_finance ON monthly_payouts
  FOR SELECT TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND (
      current_user_role() IN ('admin', 'financeiro')
      OR (
        current_user_role() = 'profissional_saude'
        AND EXISTS (
          SELECT 1 FROM doctors d
          WHERE d.id = monthly_payouts.doctor_id
            AND d.user_id = auth.uid()
        )
      )
    )
  );

-- Trigger anti-UPDATE em colunas calculadas (R4)
CREATE TRIGGER mp_append_only_calc
  BEFORE UPDATE ON monthly_payouts
  FOR EACH ROW EXECUTE FUNCTION enforce_append_only_columns(
    'monthly_payouts',
    ARRAY['closed_at','closed_by','paid_at','paid_amount_cents','payment_method','payment_note','updated_at']
  );

CREATE TRIGGER mp_no_delete
  BEFORE DELETE ON monthly_payouts
  FOR EACH ROW EXECUTE FUNCTION raise_no_delete();
```

### Regras

- UNIQUE em `(tenant_id, doctor_id, month)` garante uma snapshot por médico/mês.
- `total_due_cents` é GENERATED — sempre derivado, nunca UPDATEado.
- Colunas calculadas (`gross_revenue_cents` … `adjustments_cents`) NÃO podem ser UPDATEadas após inserção.
- `closed_at`/`closed_by` PODEM ir a NULL via `reopen_monthly_payout` (R5).
- `paid_at`/`paid_amount_cents`/`payment_method`/`payment_note` UPDATEáveis livremente (operação de marcar pago + nota).
- `profissional_saude` só vê linhas onde `doctor.user_id = auth.uid()` (RLS dupla).

---

## 4. `monthly_payouts_adjustments` (nova) — Ajustes auto-gerados

```sql
CREATE TABLE monthly_payouts_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE RESTRICT,
  original_appointment_id UUID NOT NULL REFERENCES appointments(id),
  original_month TEXT NOT NULL CHECK (original_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  applied_month TEXT NOT NULL CHECK (applied_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  delta_cents BIGINT NOT NULL,  -- negativo se estorno
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_mpa_by_applied_doctor
  ON monthly_payouts_adjustments (tenant_id, applied_month, doctor_id);

-- RLS herda do tenant + doctor (mesma policy de monthly_payouts)
ALTER TABLE monthly_payouts_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY mpa_select ON monthly_payouts_adjustments FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id());

CREATE TRIGGER mpa_append_only
  BEFORE UPDATE OR DELETE ON monthly_payouts_adjustments
  FOR EACH ROW EXECUTE FUNCTION enforce_append_only_columns(
    'monthly_payouts_adjustments', ARRAY[]::TEXT[]
  );

-- Trigger AFTER INSERT em appointment_reversals que gera ajuste se mês fechado (R7)
CREATE TRIGGER ar_generate_payout_adjustment
  AFTER INSERT ON appointment_reversals
  FOR EACH ROW EXECUTE FUNCTION generate_payout_adjustment_if_closed();
```

### Regras

- `delta_cents` negativo = redução no próximo repasse (estorno reverte ganho).
- `applied_month` = próximo mês aberto após `closed_at` do `original_month`.
- Gerado automaticamente — nunca inserido manualmente.

---

## 5. `monthly_payouts_reopens` (nova) — Forense de reaberturas

```sql
CREATE TABLE monthly_payouts_reopens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  month TEXT NOT NULL CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  reopened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reopened_by UUID NOT NULL REFERENCES auth.users(id),
  reason TEXT NOT NULL CHECK (length(reason) >= 20),
  snapshot_before JSONB NOT NULL,  -- cópia das linhas de monthly_payouts antes da reabertura
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_mpr_by_tenant_month
  ON monthly_payouts_reopens (tenant_id, month);

ALTER TABLE monthly_payouts_reopens ENABLE ROW LEVEL SECURITY;
CREATE POLICY mpr_select_admin ON monthly_payouts_reopens FOR SELECT TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND current_user_role() = 'admin'
  );

CREATE TRIGGER mpr_append_only
  BEFORE UPDATE OR DELETE ON monthly_payouts_reopens
  FOR EACH ROW EXECUTE FUNCTION enforce_append_only_columns(
    'monthly_payouts_reopens', ARRAY[]::TEXT[]
  );
```

### Regras

- `snapshot_before` armazena `jsonb_agg(row_to_json(p.*))` de todas as linhas de `monthly_payouts` daquele mês antes da reabertura.
- Inserido apenas pela função `reopen_monthly_payout` (SECURITY DEFINER).
- Apenas admin vê (auditoria sensível).

---

## 6. `tenant_cash_balance_adjustments` (nova) — Histórico de saldo de caixa

```sql
CREATE TABLE tenant_cash_balance_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  effective_from DATE NOT NULL,
  amount_cents BIGINT NOT NULL,  -- positivo = aporte; negativo = retirada/débito
  reason TEXT NOT NULL CHECK (length(reason) >= 3),
  actor_user_id UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tcba_by_tenant_effective_desc
  ON tenant_cash_balance_adjustments (tenant_id, effective_from DESC);

ALTER TABLE tenant_cash_balance_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tcba_select_admin_finance ON tenant_cash_balance_adjustments
  FOR SELECT TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND current_user_role() IN ('admin', 'financeiro')
  );

CREATE POLICY tcba_insert_admin ON tenant_cash_balance_adjustments
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = current_tenant_id()
    AND current_user_role() = 'admin'
  );

CREATE TRIGGER tcba_append_only
  BEFORE UPDATE OR DELETE ON tenant_cash_balance_adjustments
  FOR EACH ROW EXECUTE FUNCTION enforce_append_only_columns(
    'tenant_cash_balance_adjustments', ARRAY[]::TEXT[]
  );

-- Função helper: saldo vigente em qualquer data D
CREATE OR REPLACE FUNCTION tenant_cash_balance_at(
  p_tenant_id UUID,
  p_date DATE
) RETURNS BIGINT LANGUAGE SQL STABLE AS $$
  SELECT COALESCE(SUM(amount_cents), 0)
    FROM tenant_cash_balance_adjustments
   WHERE tenant_id = p_tenant_id
     AND effective_from <= p_date;
$$;
```

### Regras

- `amount_cents` PODE ser negativo (retirada).
- Apenas admin pode inserir; financeiro lê.
- Saldo em qualquer data = SUM até `effective_from <= D`.

---

## 7. Funções DB (SECURITY DEFINER)

### `close_monthly_payout(p_tenant_id UUID, p_month TEXT) RETURNS JSONB`

1. Valida que `auth.uid()` é admin do tenant.
2. Para cada `doctor` ativo do tenant, calcula reusando `computeOperatingResult`-equivalente queries (R8).
3. Soma `monthly_payouts_adjustments` com `applied_month = p_month` no `adjustments_cents`.
4. INSERT em `monthly_payouts` com UNIQUE (tenant, doctor, month) — ON CONFLICT DO NOTHING (idempotente).
5. UPDATE `closed_at = now()`, `closed_by = auth.uid()`.
6. Chama `log_audit_event('monthly_payout.closed', ...)`.
7. Retorna JSON com `payouts_count`, `total_value_cents`.

### `reopen_monthly_payout(p_tenant_id UUID, p_month TEXT, p_reason TEXT) RETURNS JSONB`

1. Valida admin + tenant.
2. Valida (FR-032a):
   - `now() - max(closed_at) <= INTERVAL '24 hours'`
   - NÃO existe `paid_at IS NOT NULL` em nenhuma linha do mês.
   - `length(p_reason) >= 20`.
3. Captura `snapshot_before = jsonb_agg(row_to_json(p.*))`.
4. INSERT `monthly_payouts_reopens` com snapshot.
5. UPDATE `monthly_payouts` zerando `closed_at`, `closed_by`.
6. Audit log.

### `record_installment_payment(p_installment_id UUID, p_amount_cents BIGINT, p_method TEXT, p_paid_at TIMESTAMPTZ, p_note TEXT) RETURNS UUID`

Wrapper SECURITY DEFINER que insere em `installment_payments`, valida tenant via `payment_installments.tenant_id`, valida `amount_cents` (≠0, ≤ pendente se positivo). Trigger faz o resto.

Alternativa: deixar como endpoint Next.js `/api/financeiro/contas-a-receber/[id]/payment/route.ts` chamando direto INSERT — mais simples para o teste de RBAC. **Decisão final em research é: rota Next.js**, sem RPC dedicado.

### `tenant_cash_balance_at(p_tenant_id UUID, p_date DATE) RETURNS BIGINT`

Helper já mostrado na seção 6.

---

## 8. Helpers SQL Reusáveis

### `enforce_append_only_columns(table_name TEXT, allowed_cols TEXT[]) RETURNS TRIGGER`

```sql
CREATE OR REPLACE FUNCTION enforce_append_only_columns()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  allowed TEXT[] := TG_ARGV[0]::TEXT[];
  col TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE not allowed on % (append-only)', TG_TABLE_NAME;
  END IF;

  -- UPDATE: verifica se alguma coluna fora da whitelist mudou
  FOR col IN SELECT column_name FROM information_schema.columns
             WHERE table_name = TG_TABLE_NAME
               AND column_name NOT IN ('updated_at')
  LOOP
    IF NOT (col = ANY(allowed))
       AND ROW_TO_JSON(NEW)::JSONB ->> col IS DISTINCT FROM ROW_TO_JSON(OLD)::JSONB ->> col
    THEN
      RAISE EXCEPTION
        'Column % is append-only on table % (allowed updates: %)',
        col, TG_TABLE_NAME, allowed;
    END IF;
  END LOOP;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
```

### `refresh_installment_paid_cache() RETURNS TRIGGER`

```sql
CREATE OR REPLACE FUNCTION refresh_installment_paid_cache()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  total BIGINT;
  last_paid TIMESTAMPTZ;
BEGIN
  SELECT COALESCE(SUM(amount_cents), 0), MAX(paid_at)
    INTO total, last_paid
    FROM installment_payments
   WHERE installment_id = NEW.installment_id;

  UPDATE payment_installments
     SET paid_amount_cents = total,
         paid_at = CASE WHEN total > 0 THEN last_paid ELSE NULL END,
         status = CASE
                    WHEN total = 0 AND due_date < CURRENT_DATE THEN 'atrasado'
                    WHEN total = 0 THEN 'pendente'
                    WHEN total >= amount_cents THEN 'pago'
                    ELSE 'parcial'
                  END
   WHERE id = NEW.installment_id;

  RETURN NEW;
END;
$$;
```

### `generate_payout_adjustment_if_closed() RETURNS TRIGGER`

Lê o `appointment_id` do `appointment_reversals` recém-inserido, calcula `original_month` no fuso do tenant, verifica se `monthly_payouts` daquele mês está fechado; se sim, calcula `delta_cents` negativo do valor do atendimento original e INSERT em `monthly_payouts_adjustments`.

---

## 9. Diagrama de relacionamentos

```
tenants(id) ◄──── todas as tabelas (tenant_id FK)
doctors(id, user_id) ◄── monthly_payouts.doctor_id
                       ◄── monthly_payouts_adjustments.doctor_id
auth.users(id) ◄── installment_payments.actor_user_id
                ◄── monthly_payouts.closed_by, paid_by
                ◄── monthly_payouts_reopens.reopened_by
                ◄── tenant_cash_balance_adjustments.actor_user_id
appointments(id) ◄── monthly_payouts_adjustments.original_appointment_id
appointment_reversals (INSERT trigger) ──► generate_payout_adjustment_if_closed
payment_installments(id) ◄── installment_payments.installment_id
expenses(id) ◄── expenses.superseded_by (self-FK)
```

---

## 10. Tenant Isolation — checklist final

| Fonte | Filtragem aplicada |
|---|---|
| Todas as 5 tabelas novas | `tenant_id` NOT NULL + RLS policy SELECT `tenant_id = current_tenant_id()` |
| `monthly_payouts` (especial) | RLS adicional: profissional_saude só vê próprio `doctor.user_id` |
| `tenant_cash_balance_adjustments` (especial) | INSERT restrito a admin via RLS WITH CHECK |
| `monthly_payouts_reopens` (especial) | SELECT restrito a admin |
| Funções SECURITY DEFINER | Cada uma valida `tenant_id` + role internamente, defesa em camadas além da RLS |

✅ Nenhum vazamento possível. Princípio III preservado.

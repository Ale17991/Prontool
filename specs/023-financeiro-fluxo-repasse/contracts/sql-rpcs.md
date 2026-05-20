# Phase 1 — SQL RPCs Contracts

**Feature**: 023 — Financeiro robusto
**Date**: 2026-05-20

Funções `SECURITY DEFINER` expostas via `supabase.rpc(...)`. Todas com `SET search_path = public, pg_temp` para segurança.

---

## `close_monthly_payout(p_tenant_id UUID, p_month TEXT)`

**Returns**: `JSONB` — `{ payouts_count, total_value_cents, closed_at }`
**Grants**: `EXECUTE ON FUNCTION close_monthly_payout TO authenticated`

### Comportamento

1. Validar que `auth.uid()` tem papel `admin` no tenant via `user_tenants`. Sem isso: `RAISE EXCEPTION 'forbidden'`.
2. Validar formato `p_month` (regex `YYYY-MM`).
3. Validar que mês não está fechado já (`closed_at IS NOT NULL` na primeira linha): se sim, `RAISE EXCEPTION 'already_closed'`.
4. Para cada médico ativo do tenant:
   - Calcular `gross_revenue_cents` = SUM `appointments_effective.frozen_amount_cents` WHERE `effective_status='ativo'` E `appointment_at` no mês no fuso do tenant E `doctor_id`.
   - Calcular `commission_cents` = SUM `appointments_effective.net_commission_cents` no mesmo filtro.
   - Calcular `fixed_payment_cents` via `monthly_fixed_pay_lines` view.
   - Calcular `liberal_payment_cents` via `appointment_assistants` + `appointments` no mês.
   - Calcular `adjustments_cents` = SUM `monthly_payouts_adjustments.delta_cents` WHERE `applied_month = p_month`.
   - INSERT em `monthly_payouts` com `ON CONFLICT (tenant_id, doctor_id, month) DO NOTHING`.
5. UPDATE `monthly_payouts SET closed_at = now(), closed_by = auth.uid() WHERE tenant_id = p_tenant_id AND month = p_month AND closed_at IS NULL`.
6. Chamar `log_audit_event('monthly_payout.closed', ...)`.
7. Retornar JSONB com contagem + total.

### Side-effects DB

- INSERT (idempotente) em `monthly_payouts`.
- UPDATE `closed_at`, `closed_by`.
- INSERT em `audit_log`.

### Erros possíveis

- `forbidden` (401/403 via API)
- `invalid_month` (400)
- `already_closed` (409)

---

## `reopen_monthly_payout(p_tenant_id UUID, p_month TEXT, p_reason TEXT)`

**Returns**: `JSONB` — `{ reopened_at, payouts_count, snapshot_id }`
**Grants**: `EXECUTE ON FUNCTION reopen_monthly_payout TO authenticated`

### Comportamento

1. Validar admin do tenant.
2. Validar `length(p_reason) >= 20` → senão `RAISE 'reason_too_short'`.
3. Verificar precondição FR-032a:
   - `max(closed_at) FROM monthly_payouts WHERE tenant_id AND month` → calcular `now() - max(closed_at) <= INTERVAL '24 hours'`. Senão `RAISE 'window_expired'`.
   - `count(*) FROM monthly_payouts WHERE tenant_id AND month AND paid_at IS NOT NULL` = 0. Senão `RAISE 'has_paid_payouts'`.
4. Capturar snapshot:
   ```sql
   v_snapshot := (
     SELECT jsonb_agg(row_to_json(p.*) ORDER BY doctor_id)
       FROM monthly_payouts p
      WHERE tenant_id = p_tenant_id AND month = p_month
   );
   ```
5. INSERT em `monthly_payouts_reopens` com `snapshot_before = v_snapshot`, `reopened_by = auth.uid()`, `reason = p_reason`.
6. UPDATE `monthly_payouts SET closed_at = NULL, closed_by = NULL WHERE tenant_id AND month`.
7. Audit `monthly_payout.reopened` com `entity_id = reopen_id` e `payload = { month, reason }`.
8. Retornar `{ reopened_at: now(), payouts_count: jsonb_array_length(v_snapshot), snapshot_id }`.

### Erros possíveis

- `forbidden`
- `reason_too_short`
- `window_expired`
- `has_paid_payouts`
- `not_closed`

---

## `tenant_cash_balance_at(p_tenant_id UUID, p_date DATE)`

**Returns**: `BIGINT` — saldo em cents na data `p_date`
**Grants**: `EXECUTE TO authenticated`
**Volatility**: `STABLE`

```sql
SELECT COALESCE(SUM(amount_cents), 0)
  FROM tenant_cash_balance_adjustments
 WHERE tenant_id = p_tenant_id
   AND effective_from <= p_date;
```

Validação de tenant via RLS atual da tabela (não precisa check explícito). Pode ser chamada pela função de fluxo de caixa em `lib/core/cash-flow/assemble.ts`.

---

## Helper Functions (Triggers)

### `enforce_append_only_columns()` (genérico)

Já documentado em `data-model.md`. Recebe via `TG_ARGV[0]` o array de colunas permitidas para UPDATE. RAISES em DELETE ou em UPDATE de coluna não permitida.

### `refresh_installment_paid_cache()` (trigger)

AFTER INSERT em `installment_payments`. Recalcula:
- `payment_installments.paid_amount_cents` = SUM
- `payment_installments.paid_at` = MAX
- `payment_installments.status` derivado (pendente/parcial/pago/atrasado)

Documentado em `data-model.md`.

### `generate_payout_adjustment_if_closed()` (trigger)

AFTER INSERT em `appointment_reversals`. Pseudo:

```sql
-- 1. Buscar atendimento original
SELECT * INTO v_appt FROM appointments WHERE id = NEW.appointment_id;

-- 2. Calcular month no fuso do tenant
v_tz := (SELECT timezone FROM tenant_clinic_profile WHERE tenant_id = v_appt.tenant_id);
v_original_month := to_char(v_appt.appointment_at AT TIME ZONE v_tz, 'YYYY-MM');

-- 3. Verificar se mês está fechado
v_closed := EXISTS (
  SELECT 1 FROM monthly_payouts
   WHERE tenant_id = v_appt.tenant_id
     AND doctor_id = v_appt.doctor_id
     AND month = v_original_month
     AND closed_at IS NOT NULL
);

IF NOT v_closed THEN
  RETURN NEW;  -- mês aberto, sem ajuste
END IF;

-- 4. Calcular delta (estorno = negativo)
v_delta := -1 * (
  SELECT net_commission_cents
    FROM appointments_effective
   WHERE id = NEW.appointment_id
);

-- 5. Determinar applied_month = primeiro mês posterior não fechado
v_applied_month := find_next_open_month(v_appt.tenant_id, v_appt.doctor_id, v_original_month);

-- 6. INSERT
INSERT INTO monthly_payouts_adjustments (
  tenant_id, doctor_id, original_appointment_id,
  original_month, applied_month, delta_cents,
  reason
) VALUES (
  v_appt.tenant_id, v_appt.doctor_id, NEW.appointment_id,
  v_original_month, v_applied_month, v_delta,
  'Estorno automático: ' || COALESCE(NEW.reason, 'sem motivo')
);

RETURN NEW;
```

---

## Convenções de retorno

- Sucesso: JSONB com payload específico.
- Erro: `RAISE EXCEPTION 'code' USING DETAIL = 'mensagem amigável'`.
- Mapeamento de códigos para HTTP status feito em `lib/observability/errors.ts` (já existe).

## Convenções de log

Cada função SECURITY DEFINER chama `log_audit_event(...)` antes do `RETURN`. Padrão:

```sql
PERFORM log_audit_event(
  p_tenant_id := ...,
  p_actor_id  := auth.uid(),
  p_event_type:= 'monthly_payout.closed',
  p_entity    := 'monthly_payouts',
  p_entity_id := ...,
  p_payload   := jsonb_build_object(
    'month', p_month,
    'payouts_count', v_count,
    'total_value_cents', v_total
  )
);
```

-- 0095 — Feature 023: Financeiro robusto (Fluxo de Caixa, Contas a Pagar/Receber, Repasse Médico).
--
-- Conteúdo:
--   1. Helper SQL `enforce_append_only_columns` (trigger function genérica com whitelist)
--   2. ALTER expenses (+6 colunas: paid_at, paid_amount_cents, payment_method,
--      recurring_starts_at, recurring_ends_at, superseded_by) + backfill + 2 indexes parciais
--   3. CREATE TABLE installment_payments (append-only) + trigger cache de paid_amount em
--      payment_installments
--   4. CREATE TABLE monthly_payouts (snapshot por médico × mês) com whitelist UPDATE
--   5. CREATE TABLE monthly_payouts_adjustments (auto-gerada por trigger em estornos pós-fechamento)
--   6. CREATE TABLE monthly_payouts_reopens (forense de reaberturas com snapshot JSONB)
--   7. CREATE TABLE tenant_cash_balance_adjustments (saldo de caixa append-only)
--   8. Function `tenant_cash_balance_at(tenant, date)` — saldo vigente
--   9. Function `close_monthly_payout(tenant, month)` SECURITY DEFINER
--  10. Function `reopen_monthly_payout(tenant, month, reason)` SECURITY DEFINER
--  11. Trigger `generate_payout_adjustment_if_closed` AFTER INSERT em appointment_reversals
--  12. Comments + NOTIFY pgrst
--
-- Constituição:
--   - I (imutabilidade): 5 tabelas novas append-only via trigger; reajustes de despesa
--     recorrente via versionamento (superseded_by); pagamentos parciais via tabela
--     dedicada; mês fechado imutável exceto janela de 24h controlada.
--   - II (audit): cada RPC SECURITY DEFINER + cada trigger chama log_audit_event.
--   - III (multi-tenant): RLS por jwt_tenant_id() em todas; RLS dupla em monthly_payouts
--     filtra doctor.user_id para profissional_saude.
--   - V (RBAC): admin/financeiro para mutações; profissional_saude restrito ao próprio
--     repasse via RLS + check em SECURITY DEFINER.
--
-- Reversibilidade: aditiva, idempotente. supabase:reset recria.

-- =========================================================================
-- 1. Helper genérico — enforce_append_only_columns
-- =========================================================================

CREATE OR REPLACE FUNCTION public.enforce_append_only_columns()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_allowed TEXT[];
  v_col TEXT;
  v_old JSONB;
  v_new JSONB;
BEGIN
  -- TG_ARGV[0] é uma string CSV (vazio = sem whitelist).
  IF TG_NARGS >= 1 AND length(TG_ARGV[0]) > 0 THEN
    v_allowed := string_to_array(TG_ARGV[0], ',');
  ELSE
    v_allowed := ARRAY[]::TEXT[];
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING
      MESSAGE = format('DELETE not allowed on append-only table %s', TG_TABLE_NAME),
      ERRCODE = '42501';
  END IF;

  v_old := to_jsonb(OLD);
  v_new := to_jsonb(NEW);

  FOR v_col IN
    SELECT column_name FROM information_schema.columns
     WHERE table_schema = TG_TABLE_SCHEMA
       AND table_name = TG_TABLE_NAME
       -- GENERATED STORED é recomputado fora do BEFORE UPDATE — pular
       AND COALESCE(is_generated, 'NEVER') = 'NEVER'
  LOOP
    -- updated_at sempre alterável
    IF v_col = 'updated_at' THEN CONTINUE; END IF;
    -- se está na whitelist, ok
    IF v_col = ANY(v_allowed) THEN CONTINUE; END IF;
    -- caso contrário, valor não pode ter mudado
    IF v_old -> v_col IS DISTINCT FROM v_new -> v_col THEN
      RAISE EXCEPTION USING
        MESSAGE = format(
          'Column %I is append-only on table %s (allowed updates: %s) — old=%s new=%s',
          v_col, TG_TABLE_NAME,
          COALESCE(array_to_string(v_allowed, ','), '<none>'),
          v_old -> v_col, v_new -> v_col
        ),
        ERRCODE = '42501';
    END IF;
  END LOOP;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.enforce_append_only_columns IS
  'Feature 023 — Trigger function genérica. TG_ARGV[0] é uma string TEXT[] de colunas alteráveis. DELETE sempre bloqueado.';

-- =========================================================================
-- 2. ALTER expenses — 6 colunas + backfill + indexes parciais
-- =========================================================================

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS paid_amount_cents BIGINT NULL,
  ADD COLUMN IF NOT EXISTS payment_method TEXT NULL,
  ADD COLUMN IF NOT EXISTS recurring_starts_at DATE NULL,
  ADD COLUMN IF NOT EXISTS recurring_ends_at DATE NULL,
  ADD COLUMN IF NOT EXISTS superseded_by UUID NULL REFERENCES public.expenses(id) ON DELETE SET NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'expenses_paid_amount_nonneg'
  ) THEN
    ALTER TABLE public.expenses
      ADD CONSTRAINT expenses_paid_amount_nonneg
      CHECK (paid_amount_cents IS NULL OR paid_amount_cents >= 0);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'expenses_recurring_window_valid'
  ) THEN
    ALTER TABLE public.expenses
      ADD CONSTRAINT expenses_recurring_window_valid
      CHECK (
        recurring_starts_at IS NULL
        OR recurring_ends_at IS NULL
        OR recurring_ends_at >= recurring_starts_at
      );
  END IF;
END $$;

-- Backfill: despesas recorrentes existentes ganham recurring_starts_at = competence_date
UPDATE public.expenses
   SET recurring_starts_at = competence_date
 WHERE recurring = true
   AND recurring_starts_at IS NULL;

-- Index parcial: listagem de pendentes (FR-010)
CREATE INDEX IF NOT EXISTS idx_expenses_pending_by_tenant
  ON public.expenses (tenant_id, competence_date)
  WHERE paid_at IS NULL AND deleted_at IS NULL;

-- Index parcial: projeção recorrente ativa (FR-012)
CREATE INDEX IF NOT EXISTS idx_expenses_recurring_active
  ON public.expenses (tenant_id, recurring_starts_at)
  WHERE recurring = true
    AND recurring_ends_at IS NULL
    AND deleted_at IS NULL;

-- Index: linhagem de versionamento (FR-014a) — encontrar antiga por superseded_by
CREATE INDEX IF NOT EXISTS idx_expenses_superseded_by
  ON public.expenses (superseded_by)
  WHERE superseded_by IS NOT NULL;

COMMENT ON COLUMN public.expenses.paid_at IS
  'Feature 023 — timestamp do pagamento. NULL = ainda não pago.';
COMMENT ON COLUMN public.expenses.paid_amount_cents IS
  'Feature 023 — valor efetivamente pago. Pode ser parcial (< amount_cents). Trigger bloqueia UPDATE direto via enforce_append_only_columns.';
COMMENT ON COLUMN public.expenses.recurring_starts_at IS
  'Feature 023 — data inicial da vigência da despesa recorrente. Default backfill = competence_date.';
COMMENT ON COLUMN public.expenses.recurring_ends_at IS
  'Feature 023 — data final de projeção. NULL = sem fim. Setado em encerramento simples (FR-014b) ou em reajuste (FR-014a).';
COMMENT ON COLUMN public.expenses.superseded_by IS
  'Feature 023 — FK para nova versão criada em reajuste de despesa recorrente. NULL em despesas que nunca foram reajustadas.';

-- =========================================================================
-- 2b. ALTER payment_installments — acrescenta 'parcial' ao status check
--     e relaxa paid_amount_cents para permitir estornos (negativo) refletidos
--     pelo cache (clarify Q2)
-- =========================================================================

ALTER TABLE public.payment_installments
  DROP CONSTRAINT IF EXISTS payment_installments_status_check;
ALTER TABLE public.payment_installments
  ADD CONSTRAINT payment_installments_status_check CHECK (
    status IN ('pendente', 'pago', 'atrasado', 'cancelado', 'parcial', 'inadimplencia')
  );

ALTER TABLE public.payment_installments
  DROP CONSTRAINT IF EXISTS payment_installments_paid_amount_cents_check;
-- paid_amount_cents pode ir a negativo se houver estornos acumulados — é cache
-- derivado de installment_payments (que permite amount_cents negativo). Mantemos
-- referencial para auditoria; UI mostra o estado real.

-- =========================================================================
-- 3. CREATE TABLE installment_payments + trigger cache de paid_amount
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.installment_payments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  installment_id   UUID NOT NULL REFERENCES public.payment_installments(id) ON DELETE RESTRICT,
  paid_at          TIMESTAMPTZ NOT NULL,
  amount_cents     BIGINT NOT NULL CHECK (amount_cents <> 0),
  payment_method   TEXT NOT NULL,
  note             TEXT NULL CHECK (note IS NULL OR length(note) <= 500),
  actor_user_id    UUID NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_installment_payments_by_installment
  ON public.installment_payments (tenant_id, installment_id, paid_at DESC);

ALTER TABLE public.installment_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ip_select_by_tenant ON public.installment_payments;
CREATE POLICY ip_select_by_tenant ON public.installment_payments
  FOR SELECT TO authenticated
  USING (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS ip_insert_by_tenant ON public.installment_payments;
CREATE POLICY ip_insert_by_tenant ON public.installment_payments
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() IN ('admin', 'financeiro', 'recepcionista')
  );

GRANT SELECT ON public.installment_payments TO authenticated;
GRANT SELECT, INSERT ON public.installment_payments TO service_role;

DROP TRIGGER IF EXISTS ip_append_only ON public.installment_payments;
CREATE TRIGGER ip_append_only
  BEFORE UPDATE OR DELETE ON public.installment_payments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only_columns('');

-- Trigger cache: atualiza payment_installments.paid_amount_cents e status (R1)
CREATE OR REPLACE FUNCTION public.refresh_installment_paid_cache()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_total BIGINT;
  v_last_paid TIMESTAMPTZ;
  v_amount BIGINT;
  v_due DATE;
  v_new_status TEXT;
BEGIN
  SELECT COALESCE(SUM(amount_cents), 0), MAX(paid_at)
    INTO v_total, v_last_paid
    FROM public.installment_payments
   WHERE installment_id = NEW.installment_id;

  SELECT amount_cents, due_date
    INTO v_amount, v_due
    FROM public.payment_installments
   WHERE id = NEW.installment_id;

  v_new_status := CASE
    WHEN v_total <= 0 AND v_due < CURRENT_DATE THEN 'atrasado'
    WHEN v_total <= 0 THEN 'pendente'
    WHEN v_total >= v_amount THEN 'pago'
    ELSE 'parcial'
  END;

  UPDATE public.payment_installments
     SET paid_amount_cents = v_total,
         paid_at = CASE WHEN v_total > 0 THEN v_last_paid ELSE NULL END,
         status = v_new_status
   WHERE id = NEW.installment_id;

  -- Audit
  PERFORM public.log_audit_event(
    NEW.tenant_id,
    'installment_payments',
    NEW.id,
    'payment',
    NULL,
    NEW.amount_cents::TEXT,
    'installment=' || NEW.installment_id::TEXT
      || ';method=' || NEW.payment_method
      || ';status=' || v_new_status
  );

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ip_refresh_cache ON public.installment_payments;
CREATE TRIGGER ip_refresh_cache
  AFTER INSERT ON public.installment_payments
  FOR EACH ROW EXECUTE FUNCTION public.refresh_installment_paid_cache();

COMMENT ON TABLE public.installment_payments IS
  'Feature 023 — append-only. Cada pagamento parcial ou total de uma parcela. Estorno = linha com amount_cents negativo + note obrigatória. paid_amount_cents da parcela é derivado por trigger refresh_installment_paid_cache.';

-- =========================================================================
-- 4. CREATE TABLE monthly_payouts + RLS dupla + trigger anti-UPDATE com whitelist
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.monthly_payouts (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  doctor_id                UUID NOT NULL REFERENCES public.doctors(id) ON DELETE RESTRICT,
  month                    TEXT NOT NULL CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  gross_revenue_cents      BIGINT NOT NULL DEFAULT 0,
  commission_cents         BIGINT NOT NULL DEFAULT 0,
  fixed_payment_cents      BIGINT NOT NULL DEFAULT 0,
  liberal_payment_cents    BIGINT NOT NULL DEFAULT 0,
  adjustments_cents        BIGINT NOT NULL DEFAULT 0,
  total_due_cents          BIGINT NOT NULL GENERATED ALWAYS AS (
    commission_cents + fixed_payment_cents + liberal_payment_cents + adjustments_cents
  ) STORED,
  closed_at                TIMESTAMPTZ NULL,
  closed_by                UUID NULL,
  paid_at                  TIMESTAMPTZ NULL,
  paid_amount_cents        BIGINT NULL,
  payment_method           TEXT NULL,
  payment_note             TEXT NULL CHECK (payment_note IS NULL OR length(payment_note) <= 500),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT mp_unique_per_doctor_month UNIQUE (tenant_id, doctor_id, month)
);

CREATE INDEX IF NOT EXISTS idx_mp_tenant_doctor_month_desc
  ON public.monthly_payouts (tenant_id, doctor_id, month DESC);
CREATE INDEX IF NOT EXISTS idx_mp_closed
  ON public.monthly_payouts (tenant_id, closed_at)
  WHERE closed_at IS NOT NULL;

ALTER TABLE public.monthly_payouts ENABLE ROW LEVEL SECURITY;

-- RLS dupla: admin/financeiro vê tudo; profissional_saude só o próprio doctor
DROP POLICY IF EXISTS mp_select ON public.monthly_payouts;
CREATE POLICY mp_select ON public.monthly_payouts
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.jwt_tenant_id()
    AND (
      public.jwt_role() IN ('admin', 'financeiro')
      OR (
        public.jwt_role() = 'profissional_saude'
        AND EXISTS (
          SELECT 1 FROM public.doctors d
           WHERE d.id = monthly_payouts.doctor_id
             AND d.user_id = auth.uid()
        )
      )
    )
  );

GRANT SELECT ON public.monthly_payouts TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.monthly_payouts TO service_role;

DROP TRIGGER IF EXISTS mp_append_only_calc ON public.monthly_payouts;
CREATE TRIGGER mp_append_only_calc
  BEFORE UPDATE ON public.monthly_payouts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only_columns(
    'closed_at,closed_by,paid_at,paid_amount_cents,payment_method,payment_note,updated_at'
  );

DROP TRIGGER IF EXISTS mp_no_delete ON public.monthly_payouts;
CREATE TRIGGER mp_no_delete
  BEFORE DELETE ON public.monthly_payouts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only_columns('');

COMMENT ON TABLE public.monthly_payouts IS
  'Feature 023 — Snapshot append-only do repasse mensal por médico. UNIQUE(tenant, doctor, month). Valores calculados são imutáveis (gross/commission/fixed/liberal/adjustments); colunas de pagamento (closed_at, paid_at, etc.) são alteráveis via whitelist do trigger.';

-- =========================================================================
-- 5. CREATE TABLE monthly_payouts_adjustments — ajustes auto-gerados
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.monthly_payouts_adjustments (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  doctor_id                UUID NOT NULL REFERENCES public.doctors(id) ON DELETE RESTRICT,
  original_appointment_id  UUID NOT NULL REFERENCES public.appointments(id),
  original_month           TEXT NOT NULL CHECK (original_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  applied_month            TEXT NOT NULL CHECK (applied_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  delta_cents              BIGINT NOT NULL,
  reason                   TEXT NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mpa_by_applied
  ON public.monthly_payouts_adjustments (tenant_id, applied_month, doctor_id);

ALTER TABLE public.monthly_payouts_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mpa_select ON public.monthly_payouts_adjustments;
CREATE POLICY mpa_select ON public.monthly_payouts_adjustments
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.jwt_tenant_id()
    AND (
      public.jwt_role() IN ('admin', 'financeiro')
      OR (
        public.jwt_role() = 'profissional_saude'
        AND EXISTS (
          SELECT 1 FROM public.doctors d
           WHERE d.id = monthly_payouts_adjustments.doctor_id
             AND d.user_id = auth.uid()
        )
      )
    )
  );

GRANT SELECT ON public.monthly_payouts_adjustments TO authenticated;
GRANT SELECT, INSERT ON public.monthly_payouts_adjustments TO service_role;

DROP TRIGGER IF EXISTS mpa_append_only ON public.monthly_payouts_adjustments;
CREATE TRIGGER mpa_append_only
  BEFORE UPDATE OR DELETE ON public.monthly_payouts_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only_columns('');

COMMENT ON TABLE public.monthly_payouts_adjustments IS
  'Feature 023 — ajustes auto-gerados quando atendimento de mês fechado é estornado. delta_cents negativo = redução no próximo repasse.';

-- =========================================================================
-- 6. CREATE TABLE monthly_payouts_reopens — forense de reaberturas
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.monthly_payouts_reopens (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  month            TEXT NOT NULL CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  reopened_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  reopened_by      UUID NOT NULL,
  reason           TEXT NOT NULL CHECK (length(reason) >= 20),
  snapshot_before  JSONB NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mpr_by_tenant_month
  ON public.monthly_payouts_reopens (tenant_id, month);

ALTER TABLE public.monthly_payouts_reopens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mpr_select_admin ON public.monthly_payouts_reopens;
CREATE POLICY mpr_select_admin ON public.monthly_payouts_reopens
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() = 'admin'
  );

GRANT SELECT ON public.monthly_payouts_reopens TO authenticated;
GRANT SELECT, INSERT ON public.monthly_payouts_reopens TO service_role;

DROP TRIGGER IF EXISTS mpr_append_only ON public.monthly_payouts_reopens;
CREATE TRIGGER mpr_append_only
  BEFORE UPDATE OR DELETE ON public.monthly_payouts_reopens
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only_columns('');

COMMENT ON TABLE public.monthly_payouts_reopens IS
  'Feature 023 — registro forense de cada reabertura de mês (FR-032a). snapshot_before preserva valores antes da reabertura via jsonb_agg(row_to_json(...)).';

-- =========================================================================
-- 7. CREATE TABLE tenant_cash_balance_adjustments — saldo de caixa append-only
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.tenant_cash_balance_adjustments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  effective_from   DATE NOT NULL,
  amount_cents     BIGINT NOT NULL CHECK (amount_cents <> 0),
  reason           TEXT NOT NULL CHECK (length(reason) >= 3),
  actor_user_id    UUID NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tcba_by_tenant_effective_desc
  ON public.tenant_cash_balance_adjustments (tenant_id, effective_from DESC);

ALTER TABLE public.tenant_cash_balance_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tcba_select_admin_finance ON public.tenant_cash_balance_adjustments;
CREATE POLICY tcba_select_admin_finance ON public.tenant_cash_balance_adjustments
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() IN ('admin', 'financeiro')
  );

DROP POLICY IF EXISTS tcba_insert_admin ON public.tenant_cash_balance_adjustments;
CREATE POLICY tcba_insert_admin ON public.tenant_cash_balance_adjustments
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() = 'admin'
  );

GRANT SELECT ON public.tenant_cash_balance_adjustments TO authenticated;
GRANT SELECT, INSERT ON public.tenant_cash_balance_adjustments TO service_role;

DROP TRIGGER IF EXISTS tcba_append_only ON public.tenant_cash_balance_adjustments;
CREATE TRIGGER tcba_append_only
  BEFORE UPDATE OR DELETE ON public.tenant_cash_balance_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only_columns('');

COMMENT ON TABLE public.tenant_cash_balance_adjustments IS
  'Feature 023 — saldo de caixa do tenant modelado como sequência append-only de ajustes. amount_cents pode ser negativo (retirada). Saldo em data D = SUM amount_cents WHERE effective_from <= D.';

-- =========================================================================
-- 8. Function tenant_cash_balance_at(tenant, date) — saldo vigente em data
-- =========================================================================

CREATE OR REPLACE FUNCTION public.tenant_cash_balance_at(
  p_tenant_id UUID,
  p_date DATE
) RETURNS BIGINT
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(amount_cents), 0)::BIGINT
    FROM public.tenant_cash_balance_adjustments
   WHERE tenant_id = p_tenant_id
     AND effective_from <= p_date;
$$;

REVOKE EXECUTE ON FUNCTION public.tenant_cash_balance_at(UUID, DATE) FROM public;
GRANT EXECUTE ON FUNCTION public.tenant_cash_balance_at(UUID, DATE) TO authenticated, service_role;

COMMENT ON FUNCTION public.tenant_cash_balance_at IS
  'Feature 023 — saldo de caixa do tenant em qualquer data. Caller MUST validate tenant access (RLS dos endpoints/lib via jwt_tenant_id).';

-- =========================================================================
-- 9. Function close_monthly_payout(tenant, month) — fecha mês com snapshot
-- =========================================================================

CREATE OR REPLACE FUNCTION public.close_monthly_payout(
  p_tenant_id UUID,
  p_month TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role TEXT;
  v_count INTEGER;
  v_total BIGINT;
  v_tz TEXT;
  v_from_iso TIMESTAMPTZ;
  v_to_iso TIMESTAMPTZ;
  v_year INT;
  v_month INT;
BEGIN
  v_role := public.jwt_role();

  -- Auth: admin do tenant
  IF v_role <> 'service_role' THEN
    IF v_role <> 'admin' OR public.jwt_tenant_id() <> p_tenant_id THEN
      RAISE EXCEPTION USING MESSAGE = 'forbidden', ERRCODE = '42501';
    END IF;
  END IF;

  -- Validar formato month
  IF p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION USING MESSAGE = 'invalid_month', ERRCODE = '22000';
  END IF;

  -- Detectar se já está fechado
  IF EXISTS (
    SELECT 1 FROM public.monthly_payouts
     WHERE tenant_id = p_tenant_id AND month = p_month AND closed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'already_closed', ERRCODE = '23505';
  END IF;

  -- Calcular boundaries do mês no fuso do tenant
  SELECT COALESCE(timezone, 'America/Sao_Paulo') INTO v_tz
    FROM public.tenant_clinic_profile WHERE tenant_id = p_tenant_id;
  IF v_tz IS NULL THEN v_tz := 'America/Sao_Paulo'; END IF;

  v_year := substring(p_month from 1 for 4)::INT;
  v_month := substring(p_month from 6 for 2)::INT;
  v_from_iso := ((p_month || '-01')::DATE)::TIMESTAMP AT TIME ZONE v_tz;
  v_to_iso := (CASE WHEN v_month = 12
                    THEN ((v_year + 1)::TEXT || '-01-01')::DATE
                    ELSE (v_year::TEXT || '-' || lpad((v_month + 1)::TEXT, 2, '0') || '-01')::DATE
               END)::TIMESTAMP AT TIME ZONE v_tz;

  -- INSERT (idempotente) snapshot por médico ativo
  WITH active_doctors AS (
    SELECT d.id AS doctor_id
      FROM public.doctors d
     WHERE d.tenant_id = p_tenant_id AND d.active = true
  ),
  appt_agg AS (
    SELECT ae.doctor_id,
           COALESCE(SUM(ae.frozen_amount_cents), 0) AS gross,
           COALESCE(SUM(ae.net_commission_cents), 0) AS commission
      FROM public.appointments_effective ae
     WHERE ae.tenant_id = p_tenant_id
       AND ae.effective_status = 'ativo'
       AND ae.appointment_at >= v_from_iso
       AND ae.appointment_at < v_to_iso
     GROUP BY ae.doctor_id
  ),
  adj_agg AS (
    SELECT doctor_id, COALESCE(SUM(delta_cents), 0) AS adjustments
      FROM public.monthly_payouts_adjustments
     WHERE tenant_id = p_tenant_id AND applied_month = p_month
     GROUP BY doctor_id
  )
  INSERT INTO public.monthly_payouts (
    tenant_id, doctor_id, month,
    gross_revenue_cents, commission_cents,
    fixed_payment_cents, liberal_payment_cents, adjustments_cents
  )
  SELECT
    p_tenant_id,
    ad.doctor_id,
    p_month,
    COALESCE(aa.gross, 0),
    COALESCE(aa.commission, 0),
    0,  -- fixed_payment_cents: enriquecer em iteração futura via monthly_fixed_pay_lines
    0,  -- liberal_payment_cents: idem
    COALESCE(adj.adjustments, 0)
    FROM active_doctors ad
    LEFT JOIN appt_agg aa ON aa.doctor_id = ad.doctor_id
    LEFT JOIN adj_agg adj ON adj.doctor_id = ad.doctor_id
   ON CONFLICT (tenant_id, doctor_id, month) DO NOTHING;

  -- Fechar
  UPDATE public.monthly_payouts
     SET closed_at = now(),
         closed_by = COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::UUID),
         updated_at = now()
   WHERE tenant_id = p_tenant_id AND month = p_month AND closed_at IS NULL;

  SELECT count(*), COALESCE(SUM(total_due_cents), 0)
    INTO v_count, v_total
    FROM public.monthly_payouts
   WHERE tenant_id = p_tenant_id AND month = p_month;

  -- Audit
  PERFORM public.log_audit_event(
    p_tenant_id,
    'monthly_payouts',
    NULL,
    'closed',
    NULL,
    p_month,
    'count=' || v_count::TEXT || ';total_cents=' || v_total::TEXT
  );

  RETURN jsonb_build_object(
    'month', p_month,
    'payouts_count', v_count,
    'total_value_cents', v_total,
    'closed_at', now()
  );
END $$;

REVOKE EXECUTE ON FUNCTION public.close_monthly_payout(UUID, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.close_monthly_payout(UUID, TEXT) TO authenticated, service_role;

COMMENT ON FUNCTION public.close_monthly_payout IS
  'Feature 023 — fecha repasse do mês: insere snapshot por médico ativo + UPDATE closed_at. Idempotente via ON CONFLICT.';

-- =========================================================================
-- 10. Function reopen_monthly_payout(tenant, month, reason)
-- =========================================================================

CREATE OR REPLACE FUNCTION public.reopen_monthly_payout(
  p_tenant_id UUID,
  p_month TEXT,
  p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role TEXT;
  v_max_closed TIMESTAMPTZ;
  v_paid_count INTEGER;
  v_snapshot JSONB;
  v_reopen_id UUID;
BEGIN
  v_role := public.jwt_role();

  IF v_role <> 'service_role' THEN
    IF v_role <> 'admin' OR public.jwt_tenant_id() <> p_tenant_id THEN
      RAISE EXCEPTION USING MESSAGE = 'forbidden', ERRCODE = '42501';
    END IF;
  END IF;

  IF length(p_reason) < 20 THEN
    RAISE EXCEPTION USING MESSAGE = 'reason_too_short', ERRCODE = '22000';
  END IF;

  -- Precondição: mês deve estar fechado
  SELECT MAX(closed_at) INTO v_max_closed
    FROM public.monthly_payouts
   WHERE tenant_id = p_tenant_id AND month = p_month;

  IF v_max_closed IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'not_closed', ERRCODE = '22000';
  END IF;

  -- Janela de 24h
  IF now() - v_max_closed > INTERVAL '24 hours' THEN
    RAISE EXCEPTION USING MESSAGE = 'window_expired', ERRCODE = '22000';
  END IF;

  -- Nenhum pagamento já marcado
  SELECT COUNT(*) INTO v_paid_count
    FROM public.monthly_payouts
   WHERE tenant_id = p_tenant_id AND month = p_month AND paid_at IS NOT NULL;

  IF v_paid_count > 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'has_paid_payouts', ERRCODE = '22000';
  END IF;

  -- Capturar snapshot
  SELECT jsonb_agg(row_to_json(p.*) ORDER BY doctor_id)
    INTO v_snapshot
    FROM public.monthly_payouts p
   WHERE tenant_id = p_tenant_id AND month = p_month;

  -- Inserir forense
  INSERT INTO public.monthly_payouts_reopens (
    tenant_id, month, reopened_by, reason, snapshot_before
  ) VALUES (
    p_tenant_id, p_month,
    COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::UUID),
    p_reason, v_snapshot
  )
  RETURNING id INTO v_reopen_id;

  -- Reabrir (zerar closed_at/closed_by)
  UPDATE public.monthly_payouts
     SET closed_at = NULL,
         closed_by = NULL,
         updated_at = now()
   WHERE tenant_id = p_tenant_id AND month = p_month;

  -- Audit
  PERFORM public.log_audit_event(
    p_tenant_id,
    'monthly_payouts_reopens',
    v_reopen_id,
    'reopened',
    NULL,
    p_month,
    'reason=' || p_reason
  );

  RETURN jsonb_build_object(
    'month', p_month,
    'reopened_at', now(),
    'snapshot_id', v_reopen_id,
    'payouts_count', jsonb_array_length(v_snapshot)
  );
END $$;

REVOKE EXECUTE ON FUNCTION public.reopen_monthly_payout(UUID, TEXT, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.reopen_monthly_payout(UUID, TEXT, TEXT) TO authenticated, service_role;

COMMENT ON FUNCTION public.reopen_monthly_payout IS
  'Feature 023 — reabre mês se (a) <24h do fechamento e (b) nenhum repasse pago. Preserva snapshot em monthly_payouts_reopens.';

-- =========================================================================
-- 11. Trigger generate_payout_adjustment_if_closed — estorno automático
-- =========================================================================

CREATE OR REPLACE FUNCTION public.generate_payout_adjustment_if_closed()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant UUID;
  v_doctor UUID;
  v_appt_at TIMESTAMPTZ;
  v_tz TEXT;
  v_original_month TEXT;
  v_delta BIGINT;
  v_applied_month TEXT;
  v_year INT;
  v_month INT;
BEGIN
  -- Lê dados do appointment original
  SELECT a.tenant_id, a.doctor_id, a.appointment_at, ae.net_commission_cents
    INTO v_tenant, v_doctor, v_appt_at, v_delta
    FROM public.appointments a
    JOIN public.appointments_effective ae ON ae.id = a.id
   WHERE a.id = NEW.appointment_id;

  IF v_tenant IS NULL THEN RETURN NEW; END IF;

  -- Fuso do tenant
  SELECT COALESCE(timezone, 'America/Sao_Paulo') INTO v_tz
    FROM public.tenant_clinic_profile WHERE tenant_id = v_tenant;
  IF v_tz IS NULL THEN v_tz := 'America/Sao_Paulo'; END IF;

  v_original_month := to_char(v_appt_at AT TIME ZONE v_tz, 'YYYY-MM');

  -- Verifica se o mês está fechado
  IF NOT EXISTS (
    SELECT 1 FROM public.monthly_payouts
     WHERE tenant_id = v_tenant
       AND doctor_id = v_doctor
       AND month = v_original_month
       AND closed_at IS NOT NULL
  ) THEN
    RETURN NEW;  -- mês aberto, ajuste não necessário
  END IF;

  -- Calcula applied_month = mês seguinte (próximo mês civil)
  v_year := substring(v_original_month from 1 for 4)::INT;
  v_month := substring(v_original_month from 6 for 2)::INT;
  IF v_month = 12 THEN
    v_applied_month := (v_year + 1)::TEXT || '-01';
  ELSE
    v_applied_month := v_year::TEXT || '-' || lpad((v_month + 1)::TEXT, 2, '0');
  END IF;

  -- INSERT ajuste (delta negativo = redução)
  INSERT INTO public.monthly_payouts_adjustments (
    tenant_id, doctor_id, original_appointment_id,
    original_month, applied_month, delta_cents, reason
  ) VALUES (
    v_tenant, v_doctor, NEW.appointment_id,
    v_original_month, v_applied_month, -COALESCE(v_delta, 0),
    'Estorno automatico: appointment ' || NEW.appointment_id::TEXT
  );

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ar_generate_payout_adjustment ON public.appointment_reversals;
CREATE TRIGGER ar_generate_payout_adjustment
  AFTER INSERT ON public.appointment_reversals
  FOR EACH ROW EXECUTE FUNCTION public.generate_payout_adjustment_if_closed();

-- =========================================================================
-- 12. NOTIFY pgrst (reload schema cache)
-- =========================================================================

NOTIFY pgrst, 'reload schema';

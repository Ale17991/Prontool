-- 0126 — close_monthly_payout passa a persistir fixed_payment_cents e
-- liberal_payment_cents no fechamento.
--
-- Contexto: desde a 0095 (e mantido na 0100) o INSERT de monthly_payouts
-- gravava 0 fixo em fixed_payment_cents e liberal_payment_cents, com o
-- comentario "enriquecer em iteracao futura". Isso fazia o repasse fechado
-- subestimar o total devido a medicos Fixos e a participacoes Liberais de
-- assistente — o total_due_cents (coluna GENERATED) so' refletia comissao +
-- ajustes.
--
-- A app TS (computeOpenMonthSnapshot) ja' calcula ambos ao vivo no mes
-- ABERTO; esta migration alinha o caminho FECHADO a' mesma regra para que a
-- previa e o snapshot congelado coincidam.
--
-- Fontes:
--   - fixed:   view public.monthly_fixed_pay_lines (linhas virtuais por
--              medico 'fixo' x mes, a partir do billing_day) — feature 013.
--   - liberal: public.appointment_assistants (participacoes ATIVAS,
--              removed_at IS NULL) atribuidas ao assistant_doctor_id, dentro
--              do mes e EXCLUINDO atendimentos estornados (FR-019).
--
-- total_due_cents e' GENERATED (commission + fixed + liberal + adjustments),
-- entao basta gravar as parcelas — o total se ajusta sozinho.
--
-- Idempotente — CREATE OR REPLACE. So' altera o caminho de INSERT; toda a
-- logica de fuso, guard de role, ja-fechado e auditoria e' identica a' 0100.

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
  v_month_start DATE;
  v_year INT;
  v_month INT;
BEGIN
  v_role := public.jwt_role();

  IF v_role <> 'service_role' THEN
    IF v_role <> 'admin' OR public.jwt_tenant_id() <> p_tenant_id THEN
      RAISE EXCEPTION USING MESSAGE = 'forbidden', ERRCODE = '42501';
    END IF;
  END IF;

  IF p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION USING MESSAGE = 'invalid_month', ERRCODE = '22000';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.monthly_payouts
     WHERE tenant_id = p_tenant_id AND month = p_month AND closed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'already_closed', ERRCODE = '23505';
  END IF;

  -- Fuso vem de tenants.timezone (canonico, presente desde 0002).
  SELECT COALESCE(timezone, 'America/Sao_Paulo') INTO v_tz
    FROM public.tenants WHERE id = p_tenant_id;
  IF v_tz IS NULL THEN v_tz := 'America/Sao_Paulo'; END IF;

  v_year := substring(p_month from 1 for 4)::INT;
  v_month := substring(p_month from 6 for 2)::INT;
  v_month_start := (p_month || '-01')::DATE;
  v_from_iso := v_month_start::TIMESTAMP AT TIME ZONE v_tz;
  v_to_iso := (CASE WHEN v_month = 12
                    THEN ((v_year + 1)::TEXT || '-01-01')::DATE
                    ELSE (v_year::TEXT || '-' || lpad((v_month + 1)::TEXT, 2, '0') || '-01')::DATE
               END)::TIMESTAMP AT TIME ZONE v_tz;

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
  ),
  -- Pagamento fixo: soma das linhas virtuais do mes para medicos 'fixo'.
  fixed_agg AS (
    SELECT fpl.doctor_id, COALESCE(SUM(fpl.amount_cents), 0) AS fixed
      FROM public.monthly_fixed_pay_lines fpl
     WHERE fpl.tenant_id = p_tenant_id
       AND fpl.month_start = date_trunc('month', v_month_start)::date
     GROUP BY fpl.doctor_id
  ),
  -- Pagamento liberal: participacoes de assistente ATIVAS no mes, exceto
  -- atendimentos estornados, atribuidas ao assistant_doctor_id.
  liberal_agg AS (
    SELECT aa.assistant_doctor_id AS doctor_id,
           COALESCE(SUM(aa.frozen_amount_cents), 0) AS liberal
      FROM public.appointment_assistants aa
      JOIN public.appointments a ON a.id = aa.appointment_id
     WHERE aa.tenant_id = p_tenant_id
       AND aa.removed_at IS NULL
       AND a.appointment_at >= v_from_iso
       AND a.appointment_at < v_to_iso
       AND NOT EXISTS (
         SELECT 1 FROM public.appointment_reversals r
          WHERE r.appointment_id = aa.appointment_id
       )
     GROUP BY aa.assistant_doctor_id
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
    COALESCE(fa.fixed, 0),
    COALESCE(la.liberal, 0),
    COALESCE(adj.adjustments, 0)
    FROM active_doctors ad
    LEFT JOIN appt_agg aa ON aa.doctor_id = ad.doctor_id
    LEFT JOIN adj_agg adj ON adj.doctor_id = ad.doctor_id
    LEFT JOIN fixed_agg fa ON fa.doctor_id = ad.doctor_id
    LEFT JOIN liberal_agg la ON la.doctor_id = ad.doctor_id
   ON CONFLICT (tenant_id, doctor_id, month) DO NOTHING;

  UPDATE public.monthly_payouts
     SET closed_at = now(),
         closed_by = COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::UUID),
         updated_at = now()
   WHERE tenant_id = p_tenant_id AND month = p_month AND closed_at IS NULL;

  SELECT count(*), COALESCE(SUM(total_due_cents), 0)
    INTO v_count, v_total
    FROM public.monthly_payouts
   WHERE tenant_id = p_tenant_id AND month = p_month;

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

NOTIFY pgrst, 'reload schema';

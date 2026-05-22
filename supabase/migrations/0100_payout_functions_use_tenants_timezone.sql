-- 0100 — Funcoes de payout (0095) passam a ler tenants.timezone.
--
-- Problema: close_monthly_payout e generate_payout_adjustment_if_closed
-- foram escritas em 0095 para ler `tenant_clinic_profile.timezone`, mas
-- essa coluna nunca foi criada (so' a 0098 acrescentou) — e em prod
-- ambas as migrations podem ainda nao ter sido aplicadas, deixando o
-- erro 'column "timezone" does not exist' aparecendo no fluxo de
-- cancelar atendimento ativo (que auto-cria estorno → dispara trigger).
--
-- A coluna canonica de fuso desde 0002 e' `tenants.timezone` (DEFAULT
-- 'America/Sao_Paulo'). Toda app TS ja le dali via getTenantTimezone.
-- Esta migration alinha as funcoes DB com essa convencao — uma fonte
-- de verdade so'.
--
-- A coluna redundante tenant_clinic_profile.timezone (se a 0098 tiver
-- rodado) fica harmless — ninguem mais a le. Pode ser dropada em
-- migration futura quando quisermos limpar.
--
-- Idempotente — CREATE OR REPLACE em ambas as funcoes.

-- =========================================================================
-- (a) close_monthly_payout — reescrita lendo tenants.timezone
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
  v_from_iso := ((p_month || '-01')::DATE)::TIMESTAMP AT TIME ZONE v_tz;
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
    0,
    0,
    COALESCE(adj.adjustments, 0)
    FROM active_doctors ad
    LEFT JOIN appt_agg aa ON aa.doctor_id = ad.doctor_id
    LEFT JOIN adj_agg adj ON adj.doctor_id = ad.doctor_id
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

-- =========================================================================
-- (b) generate_payout_adjustment_if_closed — reescrita lendo tenants.timezone
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
  SELECT a.tenant_id, a.doctor_id, a.appointment_at, ae.net_commission_cents
    INTO v_tenant, v_doctor, v_appt_at, v_delta
    FROM public.appointments a
    JOIN public.appointments_effective ae ON ae.id = a.id
   WHERE a.id = NEW.appointment_id;

  IF v_tenant IS NULL THEN RETURN NEW; END IF;

  -- Fuso vem de tenants.timezone.
  SELECT COALESCE(timezone, 'America/Sao_Paulo') INTO v_tz
    FROM public.tenants WHERE id = v_tenant;
  IF v_tz IS NULL THEN v_tz := 'America/Sao_Paulo'; END IF;

  v_original_month := to_char(v_appt_at AT TIME ZONE v_tz, 'YYYY-MM');

  IF NOT EXISTS (
    SELECT 1 FROM public.monthly_payouts
     WHERE tenant_id = v_tenant
       AND doctor_id = v_doctor
       AND month = v_original_month
       AND closed_at IS NOT NULL
  ) THEN
    RETURN NEW;
  END IF;

  v_year := substring(v_original_month from 1 for 4)::INT;
  v_month := substring(v_original_month from 6 for 2)::INT;
  IF v_month = 12 THEN
    v_applied_month := (v_year + 1)::TEXT || '-01';
  ELSE
    v_applied_month := v_year::TEXT || '-' || lpad((v_month + 1)::TEXT, 2, '0');
  END IF;

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

NOTIFY pgrst, 'reload schema';

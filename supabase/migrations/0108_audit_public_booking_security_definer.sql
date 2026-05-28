-- =============================================================================
-- 0108 — SECURITY DEFINER nos triggers de audit do agendamento publico
-- =============================================================================
-- Bug: as 3 funcoes de trigger de audit criadas na 0093
--   - audit_public_booking_doctors_change
--   - audit_public_booking_doctor_procedures_change
--   - audit_public_booking_tokens_change
-- foram criadas SECURITY INVOKER (default). Elas chamam log_audit_event que
-- insere em public.audit_log. A migration 0018 faz REVOKE INSERT em
-- audit_log do role authenticated. Resultado: qualquer write direto vindo
-- da UI (server actions rodam como authenticated) em public_booking_doctors
-- ou public_booking_doctor_procedures explode com:
--   "permission denied for table audit_log"
-- e o usuario admin nao consegue publicar medicos/procedimentos no link.
--
-- Fix: recria as 3 funcoes com SECURITY DEFINER + SET search_path. Padrao
-- ja usado pelas funcoes de audit em outras migrations (close_monthly_payout,
-- generate_user_notifications, etc.). Como o owner default das funcoes em
-- supabase e o role postgres (superuser pra tabelas public.*), o INSERT em
-- audit_log passa independente de quem dispara o trigger.
--
-- Segurança: o conteudo inserido vem de NEW/OLD do trigger + log_audit_event
-- já filtra tenant_id via session vars — nao expande superficie de ataque.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.audit_public_booking_doctors_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.log_audit_event(
    COALESCE(NEW.tenant_id, OLD.tenant_id),
    'public_booking_doctors',
    NULL,
    TG_OP,
    NULL,
    NULL,
    'doctor_id=' || COALESCE(NEW.doctor_id, OLD.doctor_id)::TEXT
  );
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE OR REPLACE FUNCTION public.audit_public_booking_doctor_procedures_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.log_audit_event(
    COALESCE(NEW.tenant_id, OLD.tenant_id),
    'public_booking_doctor_procedures',
    NULL,
    TG_OP,
    NULL,
    NULL,
    'doctor_id=' || COALESCE(NEW.doctor_id, OLD.doctor_id)::TEXT
      || ';procedure_id=' || COALESCE(NEW.procedure_id, OLD.procedure_id)::TEXT
  );
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE OR REPLACE FUNCTION public.audit_public_booking_tokens_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id,
      'public_booking_tokens',
      NEW.id,
      'created',
      NULL,
      NEW.action,
      'appointment_id=' || NEW.appointment_id::TEXT
    );
  ELSIF TG_OP = 'UPDATE' AND NEW.used_at IS NOT NULL AND OLD.used_at IS NULL THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id,
      'public_booking_tokens',
      NEW.id,
      'used',
      NULL,
      NEW.action,
      'appointment_id=' || NEW.appointment_id::TEXT
    );
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

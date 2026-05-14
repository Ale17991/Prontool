-- Migration 0084 — Modalidades de pagamento de profissional + Assistentes em atendimento
-- Spec:       specs/013-modalidades-pagamento-assistente/spec.md
-- Plan:       specs/013-modalidades-pagamento-assistente/plan.md
-- Data model: specs/013-modalidades-pagamento-assistente/data-model.md
--
-- Entregas neste arquivo:
--   1. ENUM public.payment_mode (comissionado, fixo, liberal)
--   2. ALTER public.doctors + payment_mode (DEFAULT 'comissionado' p/ retrocompat)
--   3. Tabela nova public.doctor_payment_terms_history (append-only, CHECK por modalidade)
--   4. Tabela nova public.appointment_assistants (append-only com soft-unlink via removed_at)
--   5. View public.doctor_payment_terms_current (DISTINCT ON head-of-chain)
--   6. View public.monthly_fixed_pay_lines (linhas virtuais a partir do billing_day)
--   7. RPCs: record_payment_terms_change, attach_assistant_to_appointment,
--           remove_appointment_assistant (SECURITY DEFINER com guards)
--   8. Triggers append-only + tenant consistency + liberal-only + audit
--   9. Backfill: 1 row inicial por doctor existente, herdando comissao atual
--
-- Constitution gates atendidos:
--   I  (Integridade Financeira): append-only stricto em ambas as tabelas novas;
--      frozen_amount_cents em appointment_assistants e congelado no INSERT.
--   II (Auditabilidade): triggers de audit em INSERT/UPDATE relevantes via
--      log_audit_event; reason obrigatorio (CHECK >= 3 chars).
--   III (Multi-tenant): RLS por tenant_id; UNIQUE/CHECK reforcam isolamento;
--      tenant consistency check entre appointment e assistant.
--   V  (RBAC): RPCs validam jwt_tenant_id + jwt_role onde aplicavel.

-- =========================================================================
-- 1) ENUM payment_mode
-- =========================================================================
DO $$ BEGIN
  CREATE TYPE public.payment_mode AS ENUM ('comissionado', 'fixo', 'liberal');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =========================================================================
-- 2) ALTER doctors ADD payment_mode
-- =========================================================================
ALTER TABLE public.doctors
  ADD COLUMN IF NOT EXISTS payment_mode public.payment_mode
    NOT NULL DEFAULT 'comissionado';

CREATE INDEX IF NOT EXISTS doctors_payment_mode_idx
  ON public.doctors (tenant_id, payment_mode);

-- =========================================================================
-- 3) Tabela public.doctor_payment_terms_history (append-only)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.doctor_payment_terms_history (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  doctor_id               UUID NOT NULL REFERENCES public.doctors(id) ON DELETE RESTRICT,
  payment_mode            public.payment_mode NOT NULL,
  percentage_bps          INTEGER  CHECK (percentage_bps        IS NULL OR percentage_bps        BETWEEN 0 AND 10000),
  monthly_amount_cents    BIGINT   CHECK (monthly_amount_cents  IS NULL OR monthly_amount_cents  > 0),
  billing_day             SMALLINT CHECK (billing_day           IS NULL OR billing_day BETWEEN 1 AND 28),
  liberal_default_cents   BIGINT   CHECK (liberal_default_cents IS NULL OR liberal_default_cents > 0),
  valid_from              DATE NOT NULL,
  reason                  TEXT NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 500),
  created_by              UUID NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT payment_terms_fields_match_mode CHECK (
    (payment_mode = 'comissionado' AND percentage_bps        IS NOT NULL
                                   AND monthly_amount_cents  IS NULL
                                   AND billing_day           IS NULL
                                   AND liberal_default_cents IS NULL)
    OR
    (payment_mode = 'fixo'         AND percentage_bps        IS NULL
                                   AND monthly_amount_cents  IS NOT NULL
                                   AND billing_day           IS NOT NULL
                                   AND liberal_default_cents IS NULL)
    OR
    (payment_mode = 'liberal'      AND percentage_bps        IS NULL
                                   AND monthly_amount_cents  IS NULL
                                   AND billing_day           IS NULL
                                   AND liberal_default_cents IS NOT NULL)
  ),
  UNIQUE (tenant_id, doctor_id, valid_from)
);

CREATE INDEX IF NOT EXISTS doctor_payment_terms_history_lookup_idx
  ON public.doctor_payment_terms_history (tenant_id, doctor_id, valid_from DESC, created_at DESC);

COMMENT ON TABLE public.doctor_payment_terms_history IS
  'Append-only history of payment terms per doctor (feature 013). Each row is a version effective from valid_from.';
COMMENT ON COLUMN public.doctor_payment_terms_history.payment_mode IS
  'Modalidade de pagamento vigente a partir de valid_from.';
COMMENT ON COLUMN public.doctor_payment_terms_history.percentage_bps IS
  'Percentual de comissao em basis points (0..10000) — preenchido somente quando payment_mode=comissionado.';

ALTER TABLE public.doctor_payment_terms_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_terms_read_tenant ON public.doctor_payment_terms_history;
CREATE POLICY payment_terms_read_tenant ON public.doctor_payment_terms_history
  FOR SELECT USING (tenant_id = public.jwt_tenant_id());

REVOKE INSERT, UPDATE, DELETE ON public.doctor_payment_terms_history FROM authenticated;
GRANT  SELECT                  ON public.doctor_payment_terms_history TO   authenticated;

-- Append-only enforcement (allow service_role/postgres bypass for migrations and RPCs)
CREATE OR REPLACE FUNCTION public.enforce_payment_terms_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role', 'supabase_auth_admin') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'doctor_payment_terms_history: append-only. UPDATE/DELETE not permitted.'
    USING ERRCODE = '42501';
END $$;

DROP TRIGGER IF EXISTS doctor_payment_terms_history_immutable ON public.doctor_payment_terms_history;
CREATE TRIGGER doctor_payment_terms_history_immutable
  BEFORE UPDATE OR DELETE ON public.doctor_payment_terms_history
  FOR EACH ROW EXECUTE FUNCTION public.enforce_payment_terms_immutable();

-- Audit on INSERT
CREATE OR REPLACE FUNCTION public.audit_payment_terms_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.log_audit_event(
    NEW.tenant_id,
    'doctor_payment_terms',
    NEW.id,
    'version_created',
    NULL,
    json_build_object(
      'doctor_id',             NEW.doctor_id,
      'payment_mode',          NEW.payment_mode,
      'percentage_bps',        NEW.percentage_bps,
      'monthly_amount_cents',  NEW.monthly_amount_cents,
      'billing_day',           NEW.billing_day,
      'liberal_default_cents', NEW.liberal_default_cents,
      'valid_from',            NEW.valid_from,
      'created_by',            NEW.created_by
    )::text,
    NEW.reason
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS doctor_payment_terms_history_audit ON public.doctor_payment_terms_history;
CREATE TRIGGER doctor_payment_terms_history_audit
  AFTER INSERT ON public.doctor_payment_terms_history
  FOR EACH ROW EXECUTE FUNCTION public.audit_payment_terms_insert();

-- Audit on doctors.payment_mode change (espelho do head-of-chain)
CREATE OR REPLACE FUNCTION public.audit_doctors_payment_mode_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.payment_mode IS DISTINCT FROM OLD.payment_mode THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id,
      'doctors',
      NEW.id,
      'payment_mode_changed',
      OLD.payment_mode::text,
      NEW.payment_mode::text,
      'feature 013 — espelho do head-of-chain de doctor_payment_terms_history'
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS doctors_payment_mode_audit ON public.doctors;
CREATE TRIGGER doctors_payment_mode_audit
  AFTER UPDATE OF payment_mode ON public.doctors
  FOR EACH ROW EXECUTE FUNCTION public.audit_doctors_payment_mode_change();

-- =========================================================================
-- 4) Tabela public.appointment_assistants (append-only com soft-unlink)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.appointment_assistants (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES public.tenants(id)    ON DELETE RESTRICT,
  appointment_id        UUID NOT NULL REFERENCES public.appointments(id) ON DELETE RESTRICT,
  assistant_doctor_id   UUID NOT NULL REFERENCES public.doctors(id)    ON DELETE RESTRICT,
  frozen_amount_cents   BIGINT NOT NULL CHECK (frozen_amount_cents > 0 AND frozen_amount_cents < 100000000),
  created_by            UUID NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at            TIMESTAMPTZ,
  removed_by            UUID,
  CONSTRAINT removed_pair_complete CHECK (
    (removed_at IS NULL AND removed_by IS NULL)
    OR
    (removed_at IS NOT NULL AND removed_by IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS appointment_assistants_appointment_active_idx
  ON public.appointment_assistants (appointment_id) WHERE removed_at IS NULL;

CREATE INDEX IF NOT EXISTS appointment_assistants_doctor_period_idx
  ON public.appointment_assistants (tenant_id, assistant_doctor_id, created_at DESC) WHERE removed_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS appointment_assistants_no_duplicate_active_idx
  ON public.appointment_assistants (appointment_id, assistant_doctor_id) WHERE removed_at IS NULL;

COMMENT ON TABLE public.appointment_assistants IS
  'Append-only — assistentes (profissionais liberais) vinculados a um atendimento. Soft-unlink via removed_at (feature 013).';
COMMENT ON COLUMN public.appointment_assistants.frozen_amount_cents IS
  'Valor da participacao congelado no INSERT — mudancas futuras em liberal_default_cents nao retroagem.';

ALTER TABLE public.appointment_assistants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS assistants_read_tenant ON public.appointment_assistants;
CREATE POLICY assistants_read_tenant ON public.appointment_assistants
  FOR SELECT USING (tenant_id = public.jwt_tenant_id());

REVOKE INSERT, UPDATE, DELETE ON public.appointment_assistants FROM authenticated;
GRANT  SELECT                  ON public.appointment_assistants TO   authenticated;

-- Trigger 1: append-only com mutacao restrita a removed_at/removed_by
CREATE OR REPLACE FUNCTION public.enforce_appointment_assistants_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role', 'supabase_auth_admin') THEN
    -- Permite todos os UPDATEs administrativos (RPC roda como SECURITY DEFINER).
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'appointment_assistants: append-only. DELETE not permitted.'
      USING ERRCODE = '42501';
  END IF;
  -- UPDATE: somente removed_at/removed_by podem mudar, e apenas de NULL -> NOT NULL
  IF NEW.id <> OLD.id
     OR NEW.tenant_id <> OLD.tenant_id
     OR NEW.appointment_id <> OLD.appointment_id
     OR NEW.assistant_doctor_id <> OLD.assistant_doctor_id
     OR NEW.frozen_amount_cents <> OLD.frozen_amount_cents
     OR NEW.created_by <> OLD.created_by
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'appointment_assistants: core columns immutable.'
      USING ERRCODE = '42501';
  END IF;
  IF OLD.removed_at IS NOT NULL THEN
    RAISE EXCEPTION 'appointment_assistants: already removed (id=%).', OLD.id
      USING ERRCODE = '42501';
  END IF;
  IF NEW.removed_at IS NULL OR NEW.removed_by IS NULL THEN
    RAISE EXCEPTION 'appointment_assistants: UPDATE must set both removed_at and removed_by.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS appointment_assistants_mutation_guard ON public.appointment_assistants;
CREATE TRIGGER appointment_assistants_mutation_guard
  BEFORE UPDATE OR DELETE ON public.appointment_assistants
  FOR EACH ROW EXECUTE FUNCTION public.enforce_appointment_assistants_mutation();

-- Trigger 2: tenant consistency com appointment e doctor
CREATE OR REPLACE FUNCTION public.check_assistant_tenant_consistency()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_appt_tenant   UUID;
  v_doctor_tenant UUID;
BEGIN
  SELECT tenant_id INTO v_appt_tenant   FROM public.appointments WHERE id = NEW.appointment_id;
  IF v_appt_tenant IS NULL THEN
    RAISE EXCEPTION 'appointment_assistants: appointment % nao encontrado.', NEW.appointment_id
      USING ERRCODE = '23503';
  END IF;
  SELECT tenant_id INTO v_doctor_tenant FROM public.doctors      WHERE id = NEW.assistant_doctor_id;
  IF v_doctor_tenant IS NULL THEN
    RAISE EXCEPTION 'appointment_assistants: doctor % nao encontrado.', NEW.assistant_doctor_id
      USING ERRCODE = '23503';
  END IF;
  IF NEW.tenant_id <> v_appt_tenant OR NEW.tenant_id <> v_doctor_tenant THEN
    RAISE EXCEPTION 'ASSISTANT_TENANT_MISMATCH: assistant.tenant_id=% appointment.tenant_id=% doctor.tenant_id=%',
      NEW.tenant_id, v_appt_tenant, v_doctor_tenant
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS appointment_assistants_tenant_guard ON public.appointment_assistants;
CREATE TRIGGER appointment_assistants_tenant_guard
  BEFORE INSERT ON public.appointment_assistants
  FOR EACH ROW EXECUTE FUNCTION public.check_assistant_tenant_consistency();

-- Trigger 3: assistant deve ter payment_mode='liberal' no momento do INSERT
CREATE OR REPLACE FUNCTION public.check_assistant_doctor_is_liberal()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_mode public.payment_mode;
BEGIN
  SELECT payment_mode INTO v_mode FROM public.doctors WHERE id = NEW.assistant_doctor_id;
  IF v_mode IS NULL THEN
    RAISE EXCEPTION 'ASSISTANT_DOCTOR_NOT_FOUND: %', NEW.assistant_doctor_id USING ERRCODE = '23503';
  END IF;
  IF v_mode <> 'liberal' THEN
    RAISE EXCEPTION 'ASSISTANT_NOT_LIBERAL: doctor % has payment_mode=% (expected liberal)',
      NEW.assistant_doctor_id, v_mode
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS appointment_assistants_liberal_guard ON public.appointment_assistants;
CREATE TRIGGER appointment_assistants_liberal_guard
  BEFORE INSERT ON public.appointment_assistants
  FOR EACH ROW EXECUTE FUNCTION public.check_assistant_doctor_is_liberal();

-- Trigger 4: audit em INSERT + AFTER UPDATE de removed_at
CREATE OR REPLACE FUNCTION public.audit_appointment_assistant_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id,
      'appointment_assistants',
      NEW.id,
      'added',
      NULL,
      json_build_object(
        'appointment_id',      NEW.appointment_id,
        'assistant_doctor_id', NEW.assistant_doctor_id,
        'frozen_amount_cents', NEW.frozen_amount_cents,
        'created_by',          NEW.created_by
      )::text,
      'feature 013 — assistente adicionado ao atendimento'
    );
  ELSIF TG_OP = 'UPDATE' AND OLD.removed_at IS NULL AND NEW.removed_at IS NOT NULL THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id,
      'appointment_assistants',
      NEW.id,
      'removed',
      NULL,
      json_build_object(
        'removed_at', NEW.removed_at,
        'removed_by', NEW.removed_by
      )::text,
      'feature 013 — assistente removido (soft-unlink)'
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS appointment_assistants_audit ON public.appointment_assistants;
CREATE TRIGGER appointment_assistants_audit
  AFTER INSERT OR UPDATE OF removed_at ON public.appointment_assistants
  FOR EACH ROW EXECUTE FUNCTION public.audit_appointment_assistant_change();

-- =========================================================================
-- 5) View doctor_payment_terms_current — head-of-chain por doctor
-- =========================================================================
CREATE OR REPLACE VIEW public.doctor_payment_terms_current
WITH (security_invoker = true) AS
SELECT DISTINCT ON (tenant_id, doctor_id)
  tenant_id,
  doctor_id,
  payment_mode,
  percentage_bps,
  monthly_amount_cents,
  billing_day,
  liberal_default_cents,
  valid_from,
  created_at
FROM public.doctor_payment_terms_history
WHERE valid_from <= CURRENT_DATE
ORDER BY tenant_id, doctor_id, valid_from DESC, created_at DESC;

GRANT SELECT ON public.doctor_payment_terms_current TO authenticated, service_role;

COMMENT ON VIEW public.doctor_payment_terms_current IS
  'Head-of-chain: linha vigente em doctor_payment_terms_history para cada doctor (feature 013).';

-- =========================================================================
-- 6) View monthly_fixed_pay_lines — lancamentos virtuais para Fixos
-- =========================================================================
CREATE OR REPLACE VIEW public.monthly_fixed_pay_lines
WITH (security_invoker = true) AS
SELECT
  d.tenant_id,
  d.id            AS doctor_id,
  d.full_name     AS doctor_name,
  pt.monthly_amount_cents AS amount_cents,
  pt.billing_day,
  date_trunc('month', month_start)::date AS month_start,
  make_date(
    EXTRACT(YEAR  FROM month_start)::int,
    EXTRACT(MONTH FROM month_start)::int,
    pt.billing_day
  ) AS billing_date
FROM public.doctors d
JOIN public.doctor_payment_terms_current pt ON pt.doctor_id = d.id
CROSS JOIN LATERAL generate_series(
  date_trunc('month', pt.valid_from)::date,
  date_trunc('month', CURRENT_DATE)::date,
  INTERVAL '1 month'
) AS month_start
WHERE pt.payment_mode = 'fixo'
  AND make_date(
        EXTRACT(YEAR  FROM month_start)::int,
        EXTRACT(MONTH FROM month_start)::int,
        pt.billing_day
      ) <= CURRENT_DATE
  AND d.active = true;

GRANT SELECT ON public.monthly_fixed_pay_lines TO authenticated, service_role;

COMMENT ON VIEW public.monthly_fixed_pay_lines IS
  'Virtual — uma linha por (doctor Fixo) x (mes a partir do billing_day) (feature 013).';

-- =========================================================================
-- 7) RPC record_payment_terms_change
-- =========================================================================
CREATE OR REPLACE FUNCTION public.record_payment_terms_change(
  p_tenant_id             UUID,
  p_doctor_id             UUID,
  p_payment_mode          public.payment_mode,
  p_percentage_bps        INTEGER,
  p_monthly_amount_cents  BIGINT,
  p_billing_day           SMALLINT,
  p_liberal_default_cents BIGINT,
  p_valid_from            DATE,
  p_reason                TEXT,
  p_actor                 UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_new_id     UUID;
  v_jwt_tenant UUID;
  v_jwt_role   TEXT;
BEGIN
  v_jwt_tenant := public.jwt_tenant_id();
  v_jwt_role   := public.jwt_role();

  IF v_jwt_tenant IS NOT NULL AND v_jwt_tenant <> p_tenant_id THEN
    RAISE EXCEPTION USING MESSAGE='TENANT_MISMATCH', ERRCODE='42501';
  END IF;

  -- jwt_role() retorna 'service_role' quando chamada via service_role pelo
  -- API route (ja autorizada por requireRole), e '' quando nao ha JWT.
  -- Bloqueia roles autenticadas regulares que nao sejam admin.
  IF v_jwt_role IS NOT NULL
     AND v_jwt_role <> ''
     AND v_jwt_role <> 'admin'
     AND v_jwt_role <> 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE='FORBIDDEN_ROLE', ERRCODE='42501';
  END IF;

  IF p_valid_from > CURRENT_DATE THEN
    RAISE EXCEPTION USING MESSAGE='VALID_FROM_FUTURE', ERRCODE='22023';
  END IF;

  INSERT INTO public.doctor_payment_terms_history (
    tenant_id, doctor_id, payment_mode, percentage_bps,
    monthly_amount_cents, billing_day, liberal_default_cents,
    valid_from, reason, created_by
  ) VALUES (
    p_tenant_id, p_doctor_id, p_payment_mode, p_percentage_bps,
    p_monthly_amount_cents, p_billing_day, p_liberal_default_cents,
    p_valid_from, p_reason, p_actor
  ) RETURNING id INTO v_new_id;

  UPDATE public.doctors
     SET payment_mode = p_payment_mode
   WHERE id = p_doctor_id AND tenant_id = p_tenant_id;

  RETURN v_new_id;
END $$;

GRANT EXECUTE ON FUNCTION public.record_payment_terms_change(
  UUID, UUID, public.payment_mode, INTEGER, BIGINT, SMALLINT, BIGINT, DATE, TEXT, UUID
) TO authenticated, service_role;

-- =========================================================================
-- 8) RPC attach_assistant_to_appointment
-- =========================================================================
CREATE OR REPLACE FUNCTION public.attach_assistant_to_appointment(
  p_appointment_id      UUID,
  p_assistant_doctor_id UUID,
  p_amount_cents        BIGINT,
  p_actor               UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant_id  UUID;
  v_jwt_tenant UUID;
  v_new_id     UUID;
BEGIN
  v_jwt_tenant := public.jwt_tenant_id();

  SELECT tenant_id INTO v_tenant_id FROM public.appointments WHERE id = p_appointment_id;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE='APPOINTMENT_NOT_FOUND', ERRCODE='02000';
  END IF;
  IF v_jwt_tenant IS NOT NULL AND v_jwt_tenant <> v_tenant_id THEN
    RAISE EXCEPTION USING MESSAGE='APPOINTMENT_NOT_FOUND', ERRCODE='02000';
  END IF;

  -- Bloqueia anexacao a atendimento estornado (consistente com appointment_materials/0061).
  IF EXISTS (SELECT 1 FROM public.appointment_reversals WHERE appointment_id = p_appointment_id) THEN
    RAISE EXCEPTION USING MESSAGE='APPOINTMENT_REVERSED', ERRCODE='23514';
  END IF;

  INSERT INTO public.appointment_assistants (
    tenant_id, appointment_id, assistant_doctor_id, frozen_amount_cents, created_by
  ) VALUES (
    v_tenant_id, p_appointment_id, p_assistant_doctor_id, p_amount_cents, p_actor
  ) RETURNING id INTO v_new_id;

  RETURN v_new_id;
END $$;

GRANT EXECUTE ON FUNCTION public.attach_assistant_to_appointment(UUID, UUID, BIGINT, UUID)
  TO authenticated, service_role;

-- =========================================================================
-- 9) RPC remove_appointment_assistant (soft-unlink)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.remove_appointment_assistant(
  p_id    UUID,
  p_actor UUID
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant_id  UUID;
  v_jwt_tenant UUID;
BEGIN
  v_jwt_tenant := public.jwt_tenant_id();

  SELECT tenant_id INTO v_tenant_id FROM public.appointment_assistants WHERE id = p_id;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE='ASSISTANT_NOT_FOUND', ERRCODE='02000';
  END IF;
  IF v_jwt_tenant IS NOT NULL AND v_jwt_tenant <> v_tenant_id THEN
    RAISE EXCEPTION USING MESSAGE='ASSISTANT_NOT_FOUND', ERRCODE='02000';
  END IF;

  UPDATE public.appointment_assistants
     SET removed_at = now(), removed_by = p_actor
   WHERE id = p_id AND removed_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE='ASSISTANT_ALREADY_REMOVED', ERRCODE='23514';
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.remove_appointment_assistant(UUID, UUID)
  TO authenticated, service_role;

-- =========================================================================
-- 10) Backfill: 1 row inicial em doctor_payment_terms_history por doctor existente
-- =========================================================================
INSERT INTO public.doctor_payment_terms_history (
  tenant_id, doctor_id, payment_mode, percentage_bps,
  monthly_amount_cents, billing_day, liberal_default_cents,
  valid_from, reason, created_by
)
SELECT
  d.tenant_id,
  d.id,
  'comissionado'::public.payment_mode,
  COALESCE(c.percentage_bps, 0),
  NULL, NULL, NULL,
  COALESCE(c.valid_from, CURRENT_DATE),
  'Backfill 0084 — preserva modalidade comissionado existente',
  '00000000-0000-0000-0000-000000000000'::uuid
FROM public.doctors d
LEFT JOIN LATERAL (
  SELECT percentage_bps, valid_from
  FROM public.doctor_commission_history
  WHERE doctor_id = d.id
  ORDER BY valid_from DESC, created_at DESC
  LIMIT 1
) c ON true
WHERE NOT EXISTS (
  SELECT 1 FROM public.doctor_payment_terms_history h WHERE h.doctor_id = d.id
);

-- Sanity check: cada doctor tem >= 1 row em history (raises se contagem != esperada)
DO $$
DECLARE
  v_doctors INTEGER;
  v_orphans INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_doctors FROM public.doctors;
  SELECT COUNT(*) INTO v_orphans
  FROM public.doctors d
  LEFT JOIN public.doctor_payment_terms_history h ON h.doctor_id = d.id
  WHERE h.id IS NULL;
  IF v_orphans > 0 THEN
    RAISE EXCEPTION 'BACKFILL_FAILED: % doctors sem row em doctor_payment_terms_history (total %)', v_orphans, v_doctors;
  END IF;
END $$;

-- Reload schema cache for PostgREST
NOTIFY pgrst, 'reload schema';

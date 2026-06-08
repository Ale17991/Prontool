-- 0113 — Feature 030: Portal do Paciente + Módulo de Endocrinologia.
--
-- (Numeração pula a 0112, reservada pela feature 029/TISS ainda em voo.)
--
-- Conteúdo:
--   1. CREATE patient_metric_types   — catálogo global de métricas (seed endócrino)
--   2. CREATE patient_measurements   — motor de medições longitudinais (append-only)
--   3. CREATE patient_portal_access_log — auditoria de acesso do paciente (append-only)
--   4. ALTER public_booking_rate_limits — CHECK de action ganha 'patient_login'
--   5. CREATE FUNCTION patient_portal_verify_login (DEFINER, service_role only)
--
-- Constituição:
--   - I (imutabilidade, por analogia): medições e access log são append-only;
--     correção de medição = nova linha.
--   - II (auditabilidade): todo acesso do paciente (login ok/falha, view) vai
--     para patient_portal_access_log; IP somente como hash (LGPD).
--   - III (multi-tenant): tenant_id + RLS em todas as tabelas com tenant;
--     o paciente lê via service-role escopado pela sessão HMAC (nunca via RLS).
--   - V (RBAC): INSERT de medição restrito a admin/profissional_saude.
--
-- Reversibilidade: aditiva, idempotente. supabase:reset recria.

-- =========================================================================
-- 1. patient_metric_types — catálogo global (sem tenant_id, como tuss_codes)
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.patient_metric_types (
  metric_type    TEXT PRIMARY KEY CHECK (metric_type ~ '^[a-z][a-z0-9_]{1,63}$'),
  label          TEXT NOT NULL CHECK (length(label) BETWEEN 2 AND 80),
  unit           TEXT NOT NULL CHECK (length(unit) BETWEEN 1 AND 16),
  min_plausible  NUMERIC NOT NULL,
  max_plausible  NUMERIC NOT NULL,
  specialty      TEXT NOT NULL CHECK (specialty ~ '^[a-z][a-z0-9_]{1,31}$'),
  display_order  INTEGER NOT NULL DEFAULT 0,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT patient_metric_types_range_chk CHECK (max_plausible > min_plausible)
);

COMMENT ON TABLE public.patient_metric_types IS
  'Feature 030 — Catálogo global de métricas longitudinais (FR-015/FR-016). Nova especialidade = novas linhas, sem mudança de schema. Faixas plausíveis validam INSERT em patient_measurements.';

ALTER TABLE public.patient_metric_types ENABLE ROW LEVEL SECURITY;

-- Leitura para qualquer usuário autenticado (catálogo de referência).
DROP POLICY IF EXISTS patient_metric_types_read ON public.patient_metric_types;
CREATE POLICY patient_metric_types_read ON public.patient_metric_types
  FOR SELECT TO authenticated
  USING (TRUE);

GRANT SELECT ON public.patient_metric_types TO authenticated;

-- Append-only (gestão do catálogo é via migration/seed; sem UPDATE/DELETE app).
DROP TRIGGER IF EXISTS patient_metric_types_enforce_append_only ON public.patient_metric_types;
CREATE TRIGGER patient_metric_types_enforce_append_only
  BEFORE UPDATE OR DELETE ON public.patient_metric_types
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only();

-- Seed endócrino. Faixas plausíveis = limites de "valor impossível/typo",
-- NÃO faixas de normalidade clínica. Tetos generosos para não bloquear
-- extremos reais: glicemia >600 ocorre em estado hiperosmolar (SBD);
-- colesterol/LDL muito altos em HF homozigótica; TG >5000 em
-- hipertrigliceridemia grave. Validação final com profissional de saúde
-- antes de produção (T034 do spec 030).
INSERT INTO public.patient_metric_types
  (metric_type, label, unit, min_plausible, max_plausible, specialty, display_order)
VALUES
  ('glicemia_jejum',            'Glicemia de jejum',         'mg/dL', 20, 1000,  'endocrino', 1),
  ('hba1c',                     'Hemoglobina glicada (HbA1c)', '%',   2,  20,    'endocrino', 2),
  ('circunferencia_abdominal',  'Circunferência abdominal',  'cm',    30, 250,   'endocrino', 3),
  ('colesterol_total',          'Colesterol total',          'mg/dL', 50, 1000,  'endocrino', 4),
  ('ldl',                       'LDL',                       'mg/dL', 10, 800,   'endocrino', 5),
  ('hdl',                       'HDL',                       'mg/dL', 5,  200,   'endocrino', 6),
  ('triglicerides',             'Triglicérides',             'mg/dL', 20, 10000, 'endocrino', 7)
ON CONFLICT (metric_type) DO NOTHING;

-- =========================================================================
-- 2. patient_measurements — motor de medições (append-only)
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.patient_measurements (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  patient_id          UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  metric_type         TEXT NOT NULL REFERENCES public.patient_metric_types(metric_type),
  value               NUMERIC NOT NULL,
  unit                TEXT NOT NULL,
  measured_at         DATE NOT NULL,
  notes               TEXT NULL CHECK (notes IS NULL OR length(notes) <= 2000),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.patient_measurements IS
  'Feature 030 — Medições longitudinais do paciente (FR-011/FR-012/FR-015). Append-only: correção = nova linha. Valor validado contra a faixa plausível do catálogo via trigger BEFORE INSERT.';

CREATE INDEX IF NOT EXISTS patient_measurements_series_idx
  ON public.patient_measurements (tenant_id, patient_id, metric_type, measured_at DESC);

-- Coerência BEFORE INSERT: metric_type ativo + value na faixa plausível +
-- unit default do catálogo quando ausente/vazia.
CREATE OR REPLACE FUNCTION public.validate_patient_measurement()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_type public.patient_metric_types%ROWTYPE;
BEGIN
  SELECT * INTO v_type
    FROM public.patient_metric_types
    WHERE metric_type = NEW.metric_type;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      MESSAGE = format('METRIC_TYPE_UNKNOWN: %s não existe no catálogo patient_metric_types', NEW.metric_type),
      ERRCODE = '23514';
  END IF;
  IF NOT v_type.active THEN
    RAISE EXCEPTION USING
      MESSAGE = format('METRIC_TYPE_INACTIVE: %s está desativada no catálogo', NEW.metric_type),
      ERRCODE = '23514';
  END IF;
  IF NEW.unit IS NULL OR length(trim(NEW.unit)) = 0 THEN
    NEW.unit := v_type.unit;
  END IF;
  IF NEW.value < v_type.min_plausible OR NEW.value > v_type.max_plausible THEN
    RAISE EXCEPTION USING
      MESSAGE = format(
        'MEASUREMENT_OUT_OF_RANGE: %s=%s fora da faixa plausível [%s..%s] %s',
        NEW.metric_type, NEW.value, v_type.min_plausible, v_type.max_plausible, v_type.unit
      ),
      ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS patient_measurements_validate ON public.patient_measurements;
CREATE TRIGGER patient_measurements_validate
  BEFORE INSERT ON public.patient_measurements
  FOR EACH ROW EXECUTE FUNCTION public.validate_patient_measurement();

-- Append-only: nenhum UPDATE/DELETE (sem whitelist).
DROP TRIGGER IF EXISTS patient_measurements_append_only ON public.patient_measurements;
CREATE TRIGGER patient_measurements_append_only
  BEFORE UPDATE OR DELETE ON public.patient_measurements
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only_columns('');

ALTER TABLE public.patient_measurements ENABLE ROW LEVEL SECURITY;

-- Staff: SELECT por tenant; INSERT só admin/profissional_saude (FR-014).
DROP POLICY IF EXISTS patient_measurements_tenant_read ON public.patient_measurements;
CREATE POLICY patient_measurements_tenant_read ON public.patient_measurements
  FOR SELECT TO authenticated
  USING (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS patient_measurements_clinical_insert ON public.patient_measurements;
CREATE POLICY patient_measurements_clinical_insert ON public.patient_measurements
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() IN ('admin', 'profissional_saude')
  );

GRANT SELECT, INSERT ON public.patient_measurements TO authenticated;

-- =========================================================================
-- 3. patient_portal_access_log — trilha de acesso do paciente (append-only)
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.patient_portal_access_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  patient_id  UUID NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  action      TEXT NOT NULL CHECK (action IN ('login_ok', 'login_fail', 'view')),
  ip_hash     TEXT NOT NULL,
  user_agent  TEXT NULL CHECK (user_agent IS NULL OR length(user_agent) <= 512),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.patient_portal_access_log IS
  'Feature 030 — Auditoria de acesso do paciente ao portal (FR-020, LGPD). patient_id é NULL em falha de login. IP somente como hash. Escrita exclusiva do service-role (server-side).';

CREATE INDEX IF NOT EXISTS patient_portal_access_log_tenant_idx
  ON public.patient_portal_access_log (tenant_id, created_at DESC);

DROP TRIGGER IF EXISTS patient_portal_access_log_append_only ON public.patient_portal_access_log;
CREATE TRIGGER patient_portal_access_log_append_only
  BEFORE UPDATE OR DELETE ON public.patient_portal_access_log
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only_columns('');

ALTER TABLE public.patient_portal_access_log ENABLE ROW LEVEL SECURITY;

-- Staff lê a trilha da própria clínica; escrita fica só com service_role
-- (bypassa RLS) — nenhuma policy de INSERT para authenticated.
DROP POLICY IF EXISTS patient_portal_access_log_tenant_read ON public.patient_portal_access_log;
CREATE POLICY patient_portal_access_log_tenant_read ON public.patient_portal_access_log
  FOR SELECT TO authenticated
  USING (tenant_id = public.jwt_tenant_id());

GRANT SELECT ON public.patient_portal_access_log TO authenticated;

-- =========================================================================
-- 4. ALTER public_booking_rate_limits — action ganha 'patient_login'
-- =========================================================================

ALTER TABLE public.public_booking_rate_limits
  DROP CONSTRAINT IF EXISTS public_booking_rate_limits_action_check;
ALTER TABLE public.public_booking_rate_limits
  ADD CONSTRAINT public_booking_rate_limits_action_check
  CHECK (action IN ('view_slots', 'submit', 'cancel', 'patient_login'));

-- =========================================================================
-- 5. patient_portal_verify_login — DEFINER, service_role only
-- =========================================================================
--
-- Resolve a clínica pelo slug (tenant_clinic_profile.public_booking_slug —
-- o slug é a identidade pública da clínica; o portal NÃO exige
-- public_booking_enabled, que governa só o agendamento online), acha o
-- paciente por CPF (decifrando cpf_enc) e confere a data de nascimento em
-- formato só-dígitos DDMMYYYY. Exclui anonimizados (FR-022).
--
-- CPF duplicado na mesma clínica (edge case do spec): acesso ambíguo é
-- BLOQUEADO — retorna vazio, indistinguível de credencial errada.
-- Retorno vazio = falha; o caller NUNCA diferencia "CPF não existe" de
-- "nascimento errado" (FR-019).

CREATE OR REPLACE FUNCTION public.patient_portal_verify_login(
  p_slug      TEXT,
  p_cpf       TEXT,
  p_birthdate TEXT,
  p_key       TEXT
) RETURNS TABLE (
  patient_id UUID,
  tenant_id  UUID,
  full_name  TEXT
) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp, extensions AS $$
DECLARE
  v_tenant_id UUID;
  v_matches   INTEGER;
BEGIN
  -- Entradas estritas: CPF 11 dígitos, nascimento DDMMYYYY (8 dígitos).
  IF p_cpf !~ '^\d{11}$' OR p_birthdate !~ '^\d{8}$' THEN
    RETURN;
  END IF;

  SELECT tcp.tenant_id INTO v_tenant_id
    FROM public.tenant_clinic_profile tcp
    WHERE tcp.public_booking_slug = p_slug
    LIMIT 1;
  IF v_tenant_id IS NULL THEN
    RETURN;
  END IF;

  -- CPF duplicado na clínica → ambíguo → bloqueia (nunca expõe o errado).
  SELECT count(*) INTO v_matches
    FROM public.patients p
    WHERE p.tenant_id = v_tenant_id
      AND p.anonymized_at IS NULL
      AND p.cpf_enc IS NOT NULL
      AND extensions.pgp_sym_decrypt(p.cpf_enc, p_key) = p_cpf;
  IF v_matches <> 1 THEN
    RETURN;
  END IF;

  -- Nascimento armazenado como 'YYYY-MM-DD' (cifrado); compara só dígitos
  -- rearranjados para DDMMYYYY.
  RETURN QUERY
    SELECT
      p.id,
      p.tenant_id,
      extensions.pgp_sym_decrypt(p.full_name_enc, p_key)::TEXT
    FROM public.patients p
    CROSS JOIN LATERAL (
      SELECT regexp_replace(
        COALESCE(extensions.pgp_sym_decrypt(p.birth_date_enc, p_key), ''),
        '\D', '', 'g'
      ) AS digits  -- YYYYMMDD
    ) b
    WHERE p.tenant_id = v_tenant_id
      AND p.anonymized_at IS NULL
      AND p.cpf_enc IS NOT NULL
      AND extensions.pgp_sym_decrypt(p.cpf_enc, p_key) = p_cpf
      AND length(b.digits) = 8
      AND (substring(b.digits, 7, 2) || substring(b.digits, 5, 2) || substring(b.digits, 1, 4))
          = p_birthdate
    LIMIT 1;
END $$;

REVOKE ALL ON FUNCTION public.patient_portal_verify_login(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.patient_portal_verify_login(TEXT, TEXT, TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION public.patient_portal_verify_login IS
  'Feature 030 — Login leve do portal do paciente (CPF + nascimento DDMMYYYY). DEFINER, grant só service_role. Retorno vazio = falha genérica (não revela se o CPF existe). CPF duplicado na clínica bloqueia o acesso (ambíguo).';

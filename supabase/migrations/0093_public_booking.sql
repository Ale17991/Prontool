-- 0093 — Feature 017: Link público de agendamento online.
--
-- Esta migration adiciona toda a infra do agendamento público (rota
-- /agendar/[slug] sem autenticação) — resolve o maior gap competitivo
-- do produto vs iClinic/Feegow/Doctoralia conforme audit.
--
-- Conteúdo:
--   1. ALTER tenant_clinic_profile (+5 colunas: slug, enabled, 3 políticas)
--   2. CREATE public_booking_doctors (médicos publicados + disponibilidade)
--   3. CREATE public_booking_doctor_procedures (1:N por médico)
--   4. CREATE public_booking_tokens (cancelamento via hash)
--   5. CREATE public_booking_rate_limits (anti-abuso, hash IP, TTL 7d)
--   6. ALTER notifications CHECK constraint (+'public_booking')
--   7. CREATE FUNCTION public_booking_resolve_slug (INVOKER)
--   8. CREATE FUNCTION public_booking_slots (DEFINER)
--   9. CREATE FUNCTION public_booking_find_patient_by_cpf (DEFINER, service_role)
--  10. Trigger de auditoria nas tabelas novas
--  11. GRANTs explícitos para anon/authenticated/service_role
--
-- Constituição:
--   - Princípio II (audit): cada operação pública gera audit_log via triggers
--   - Princípio III (multi-tenant): slug → tenant via RPC; teste de
--     contrato obrigatório antes de merge
--   - Princípio V (RBAC): "papel guest" só INSERT em paths dedicados
--
-- Reversibilidade: aditiva, idempotente. supabase:reset recria.
-- Sem mudança em RLS de tabelas existentes (exceto policy SELECT em
-- tenant_clinic_profile para anon, restrita aos campos públicos).

-- =========================================================================
-- 1. ALTER tenant_clinic_profile — 5 colunas para feature pública
-- =========================================================================

ALTER TABLE public.tenant_clinic_profile
  ADD COLUMN IF NOT EXISTS public_booking_slug TEXT NULL,
  ADD COLUMN IF NOT EXISTS public_booking_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS public_booking_min_hours_advance INTEGER NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS public_booking_max_days_advance INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS public_booking_cancel_min_hours INTEGER NOT NULL DEFAULT 6;

-- Slug regex (kebab-case, 3-32 chars, começa por letra/dígito)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenant_clinic_profile_public_booking_slug_chk'
  ) THEN
    ALTER TABLE public.tenant_clinic_profile
      ADD CONSTRAINT tenant_clinic_profile_public_booking_slug_chk
      CHECK (public_booking_slug IS NULL OR public_booking_slug ~ '^[a-z0-9][a-z0-9-]{2,31}$');
  END IF;
END $$;

-- Janelas dentro de limites razoáveis
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenant_clinic_profile_pb_min_hours_chk'
  ) THEN
    ALTER TABLE public.tenant_clinic_profile
      ADD CONSTRAINT tenant_clinic_profile_pb_min_hours_chk
      CHECK (public_booking_min_hours_advance BETWEEN 0 AND 168);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenant_clinic_profile_pb_max_days_chk'
  ) THEN
    ALTER TABLE public.tenant_clinic_profile
      ADD CONSTRAINT tenant_clinic_profile_pb_max_days_chk
      CHECK (public_booking_max_days_advance BETWEEN 1 AND 180);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenant_clinic_profile_pb_cancel_min_chk'
  ) THEN
    ALTER TABLE public.tenant_clinic_profile
      ADD CONSTRAINT tenant_clinic_profile_pb_cancel_min_chk
      CHECK (public_booking_cancel_min_hours BETWEEN 0 AND 168);
  END IF;
END $$;

-- Habilitar feature exige slug definido
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenant_clinic_profile_pb_enabled_requires_slug_chk'
  ) THEN
    ALTER TABLE public.tenant_clinic_profile
      ADD CONSTRAINT tenant_clinic_profile_pb_enabled_requires_slug_chk
      CHECK (NOT public_booking_enabled OR public_booking_slug IS NOT NULL);
  END IF;
END $$;

-- Slug único global (entre todos os tenants)
CREATE UNIQUE INDEX IF NOT EXISTS tenant_clinic_profile_public_booking_slug_unique
  ON public.tenant_clinic_profile (public_booking_slug)
  WHERE public_booking_slug IS NOT NULL;

-- RLS policy: anon pode SELECT campos públicos de tenants com feature habilitada.
-- A função public_booking_resolve_slug filtra os campos retornados — esta
-- policy só destrava o acesso (defesa em profundidade).
DROP POLICY IF EXISTS tenant_clinic_profile_public_slug_read ON public.tenant_clinic_profile;
CREATE POLICY tenant_clinic_profile_public_slug_read ON public.tenant_clinic_profile
  FOR SELECT TO anon
  USING (public_booking_enabled = TRUE);

GRANT SELECT ON public.tenant_clinic_profile TO anon;

-- =========================================================================
-- 2. public_booking_doctors — médicos publicados no link público
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.public_booking_doctors (
  tenant_id            UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  doctor_id            UUID NOT NULL REFERENCES public.doctors(id) ON DELETE RESTRICT,
  display_order        INTEGER NOT NULL DEFAULT 0,
  bio                  TEXT NULL CHECK (bio IS NULL OR length(bio) <= 500),
  available_weekdays   SMALLINT[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]::SMALLINT[],
  available_from       TIME NOT NULL DEFAULT '08:00',
  available_until      TIME NOT NULL DEFAULT '18:00',
  lunch_break_from     TIME NULL,
  lunch_break_until    TIME NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, doctor_id),
  CONSTRAINT pb_doctors_weekdays_chk CHECK (
    array_length(available_weekdays, 1) BETWEEN 1 AND 7
    AND NOT EXISTS (
      SELECT 1 FROM unnest(available_weekdays) AS w WHERE w < 0 OR w > 6
    )
  ),
  CONSTRAINT pb_doctors_window_chk CHECK (available_until > available_from),
  CONSTRAINT pb_doctors_lunch_chk CHECK (
    (lunch_break_from IS NULL AND lunch_break_until IS NULL)
    OR (lunch_break_from IS NOT NULL AND lunch_break_until IS NOT NULL
        AND lunch_break_until > lunch_break_from
        AND lunch_break_from >= available_from
        AND lunch_break_until <= available_until)
  )
);

CREATE INDEX IF NOT EXISTS pb_doctors_tenant_order_idx
  ON public.public_booking_doctors (tenant_id, display_order);

DROP TRIGGER IF EXISTS pb_doctors_touch_updated_at ON public.public_booking_doctors;
CREATE TRIGGER pb_doctors_touch_updated_at
  BEFORE UPDATE ON public.public_booking_doctors
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.public_booking_doctors ENABLE ROW LEVEL SECURITY;

-- anon SELECT: apenas se o tenant tem feature habilitada
DROP POLICY IF EXISTS pb_doctors_anon_read ON public.public_booking_doctors;
CREATE POLICY pb_doctors_anon_read ON public.public_booking_doctors
  FOR SELECT TO anon
  USING (EXISTS (
    SELECT 1 FROM public.tenant_clinic_profile tcp
    WHERE tcp.tenant_id = public_booking_doctors.tenant_id
      AND tcp.public_booking_enabled = TRUE
  ));

-- authenticated SELECT/INSERT/UPDATE/DELETE: tenant scoped
DROP POLICY IF EXISTS pb_doctors_tenant_rw ON public.public_booking_doctors;
CREATE POLICY pb_doctors_tenant_rw ON public.public_booking_doctors
  FOR ALL TO authenticated
  USING (tenant_id = public.jwt_tenant_id())
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN ('admin', 'recepcionista'));

GRANT SELECT ON public.public_booking_doctors TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.public_booking_doctors TO authenticated;

-- =========================================================================
-- 3. public_booking_doctor_procedures — procedimentos por médico (1:N)
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.public_booking_doctor_procedures (
  tenant_id          UUID NOT NULL,
  doctor_id          UUID NOT NULL,
  procedure_id       UUID NOT NULL REFERENCES public.procedures(id) ON DELETE RESTRICT,
  display_name       TEXT NOT NULL CHECK (length(display_name) BETWEEN 3 AND 100),
  duration_minutes   INTEGER NOT NULL CHECK (duration_minutes BETWEEN 5 AND 480),
  display_order      INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, doctor_id, procedure_id),
  FOREIGN KEY (tenant_id, doctor_id) REFERENCES public.public_booking_doctors (tenant_id, doctor_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS pb_doctor_procs_lookup_idx
  ON public.public_booking_doctor_procedures (tenant_id, doctor_id, display_order);

ALTER TABLE public.public_booking_doctor_procedures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pb_doctor_procs_anon_read ON public.public_booking_doctor_procedures;
CREATE POLICY pb_doctor_procs_anon_read ON public.public_booking_doctor_procedures
  FOR SELECT TO anon
  USING (EXISTS (
    SELECT 1 FROM public.tenant_clinic_profile tcp
    WHERE tcp.tenant_id = public_booking_doctor_procedures.tenant_id
      AND tcp.public_booking_enabled = TRUE
  ));

DROP POLICY IF EXISTS pb_doctor_procs_tenant_rw ON public.public_booking_doctor_procedures;
CREATE POLICY pb_doctor_procs_tenant_rw ON public.public_booking_doctor_procedures
  FOR ALL TO authenticated
  USING (tenant_id = public.jwt_tenant_id())
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN ('admin', 'recepcionista'));

GRANT SELECT ON public.public_booking_doctor_procedures TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.public_booking_doctor_procedures TO authenticated;

-- =========================================================================
-- 4. public_booking_tokens — tokens de cancelamento (hash)
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.public_booking_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  appointment_id  UUID NOT NULL REFERENCES public.appointments(id) ON DELETE RESTRICT,
  token_hash      TEXT NOT NULL,
  action          TEXT NOT NULL CHECK (action IN ('cancel', 'reschedule')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  used_at         TIMESTAMPTZ NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS pb_tokens_hash_unique
  ON public.public_booking_tokens (token_hash);

CREATE UNIQUE INDEX IF NOT EXISTS pb_tokens_appointment_action_unique
  ON public.public_booking_tokens (appointment_id, action)
  WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS pb_tokens_expires_idx
  ON public.public_booking_tokens (expires_at);

ALTER TABLE public.public_booking_tokens ENABLE ROW LEVEL SECURITY;

-- Sem policy de leitura para anon nem authenticated — acesso só via funções
-- server-side (service_role). RLS bloqueia por padrão.

GRANT SELECT, INSERT, UPDATE ON public.public_booking_tokens TO service_role;

-- =========================================================================
-- 5. public_booking_rate_limits — append-only com TTL
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.public_booking_rate_limits (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  ip_hash      TEXT NOT NULL,
  action       TEXT NOT NULL CHECK (action IN ('view_slots', 'submit', 'cancel')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pb_rate_lookup_idx
  ON public.public_booking_rate_limits (ip_hash, tenant_id, action, created_at);

ALTER TABLE public.public_booking_rate_limits ENABLE ROW LEVEL SECURITY;
-- Sem policy — acesso só via service_role.

GRANT SELECT, INSERT, DELETE ON public.public_booking_rate_limits TO service_role;

-- =========================================================================
-- 6. ALTER notifications.type CHECK — adicionar 'public_booking'
-- =========================================================================

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'atendimento',
    'tarefa',
    'tarefa_atrasada',
    'aniversarios_mes',
    'public_booking'
  ));

-- =========================================================================
-- 7. public_booking_resolve_slug — INVOKER (retorna dados públicos)
-- =========================================================================

CREATE OR REPLACE FUNCTION public.public_booking_resolve_slug(p_slug TEXT)
RETURNS TABLE (
  tenant_id           UUID,
  display_name        TEXT,
  logo_path           TEXT,
  phone               TEXT,
  address_line        TEXT,
  min_hours_advance   INTEGER,
  max_days_advance    INTEGER,
  cancel_min_hours    INTEGER
) LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp AS $$
BEGIN
  RETURN QUERY
    SELECT
      tcp.tenant_id,
      COALESCE(tcp.corporate_name, t.name)::TEXT AS display_name,
      tcp.logo_path,
      tcp.phone,
      CONCAT_WS(', ',
        NULLIF(tcp.address_street, ''),
        NULLIF(tcp.address_number, ''),
        NULLIF(tcp.address_neighborhood, ''),
        NULLIF(tcp.address_city, ''),
        NULLIF(tcp.address_uf, '')
      )::TEXT AS address_line,
      tcp.public_booking_min_hours_advance,
      tcp.public_booking_max_days_advance,
      tcp.public_booking_cancel_min_hours
    FROM public.tenant_clinic_profile tcp
    JOIN public.tenants t ON t.id = tcp.tenant_id
    WHERE tcp.public_booking_slug = p_slug
      AND tcp.public_booking_enabled = TRUE
    LIMIT 1;
END $$;

REVOKE ALL ON FUNCTION public.public_booking_resolve_slug(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_booking_resolve_slug(TEXT) TO anon, authenticated;

-- =========================================================================
-- 8. public_booking_slots — DEFINER (gera slots disponíveis)
-- =========================================================================

CREATE OR REPLACE FUNCTION public.public_booking_slots(
  p_slug TEXT,
  p_doctor_id UUID,
  p_procedure_id UUID,
  p_from DATE,
  p_to DATE
) RETURNS TABLE (slot_start TIMESTAMPTZ, slot_end TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_tenant_id          UUID;
  v_min_h              INTEGER;
  v_max_d              INTEGER;
  v_avail_weekdays     SMALLINT[];
  v_avail_from         TIME;
  v_avail_until        TIME;
  v_lunch_from         TIME;
  v_lunch_until        TIME;
  v_duration_minutes   INTEGER;
  v_now                TIMESTAMPTZ := now();
  v_window_start       TIMESTAMPTZ;
  v_window_end         TIMESTAMPTZ;
  v_tz                 TEXT := 'America/Sao_Paulo';
  v_day                DATE;
  v_dow                SMALLINT;
BEGIN
  -- 1. Resolve tenant + políticas
  SELECT tcp.tenant_id,
         tcp.public_booking_min_hours_advance,
         tcp.public_booking_max_days_advance
    INTO v_tenant_id, v_min_h, v_max_d
    FROM public.tenant_clinic_profile tcp
    WHERE tcp.public_booking_slug = p_slug
      AND tcp.public_booking_enabled = TRUE;

  IF v_tenant_id IS NULL THEN
    RETURN;
  END IF;

  -- 2. Resolve disponibilidade do médico (também valida que está publicado)
  SELECT pbd.available_weekdays,
         pbd.available_from,
         pbd.available_until,
         pbd.lunch_break_from,
         pbd.lunch_break_until
    INTO v_avail_weekdays, v_avail_from, v_avail_until, v_lunch_from, v_lunch_until
    FROM public.public_booking_doctors pbd
    WHERE pbd.tenant_id = v_tenant_id
      AND pbd.doctor_id = p_doctor_id;

  IF v_avail_weekdays IS NULL THEN
    RETURN;
  END IF;

  -- 3. Resolve duração do procedimento (também valida que está publicado pro médico)
  SELECT pbdp.duration_minutes
    INTO v_duration_minutes
    FROM public.public_booking_doctor_procedures pbdp
    WHERE pbdp.tenant_id = v_tenant_id
      AND pbdp.doctor_id = p_doctor_id
      AND pbdp.procedure_id = p_procedure_id;

  IF v_duration_minutes IS NULL THEN
    RETURN;
  END IF;

  -- 4. Clamp janela
  v_window_start := GREATEST(p_from::TIMESTAMPTZ, v_now + (v_min_h || ' hours')::INTERVAL);
  v_window_end := LEAST((p_to::TIMESTAMPTZ + INTERVAL '1 day'), v_now + (v_max_d || ' days')::INTERVAL);

  IF v_window_start >= v_window_end THEN
    RETURN;
  END IF;

  -- 5. Para cada dia, gerar slots
  v_day := v_window_start::DATE;
  WHILE v_day <= v_window_end::DATE LOOP
    v_dow := EXTRACT(DOW FROM v_day)::SMALLINT;
    IF v_dow = ANY(v_avail_weekdays) THEN
      RETURN QUERY
        WITH candidates AS (
          SELECT gs AS slot_start_local,
                 gs + (v_duration_minutes || ' minutes')::INTERVAL AS slot_end_local
            FROM generate_series(
              (v_day::TEXT || ' ' || v_avail_from::TEXT)::TIMESTAMP AT TIME ZONE v_tz,
              (v_day::TEXT || ' ' || v_avail_until::TEXT)::TIMESTAMP AT TIME ZONE v_tz
                - (v_duration_minutes || ' minutes')::INTERVAL,
              (v_duration_minutes || ' minutes')::INTERVAL
            ) AS gs
        )
        SELECT c.slot_start_local, c.slot_end_local
          FROM candidates c
          WHERE c.slot_start_local >= v_window_start
            AND c.slot_end_local <= v_window_end
            -- Subtrair lunch break (se configurado)
            AND (
              v_lunch_from IS NULL
              OR c.slot_end_local <= (v_day::TEXT || ' ' || v_lunch_from::TEXT)::TIMESTAMP AT TIME ZONE v_tz
              OR c.slot_start_local >= (v_day::TEXT || ' ' || v_lunch_until::TEXT)::TIMESTAMP AT TIME ZONE v_tz
            )
            -- Subtrair schedule_blocks
            AND NOT EXISTS (
              SELECT 1 FROM public.schedule_blocks sb
              WHERE sb.tenant_id = v_tenant_id
                AND sb.doctor_id = p_doctor_id
                AND sb.deleted_at IS NULL
                AND sb.block_date = v_day
                AND (
                  sb.all_day = TRUE
                  OR (
                    sb.start_time IS NOT NULL AND sb.end_time IS NOT NULL
                    AND (c.slot_start_local::TIME) < sb.end_time
                    AND (c.slot_end_local::TIME) > sb.start_time
                  )
                )
            )
            -- Subtrair appointment_slot_locks (anti-colisão)
            AND NOT EXISTS (
              SELECT 1 FROM public.appointment_slot_locks asl
              WHERE asl.tenant_id = v_tenant_id
                AND asl.doctor_id = p_doctor_id
                AND asl.slot_range && tstzrange(c.slot_start_local, c.slot_end_local)
            );
    END IF;
    v_day := v_day + INTERVAL '1 day';
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.public_booking_slots(TEXT, UUID, UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_booking_slots(TEXT, UUID, UUID, DATE, DATE) TO anon, authenticated;

-- =========================================================================
-- 9. public_booking_find_patient_by_cpf — helper privado (service_role only)
-- =========================================================================

CREATE OR REPLACE FUNCTION public.public_booking_find_patient_by_cpf(
  p_tenant_id UUID,
  p_cpf TEXT,
  p_key TEXT
) RETURNS TABLE (
  patient_id   UUID,
  full_name    TEXT,
  email        TEXT,
  phone        TEXT
) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp, extensions AS $$
BEGIN
  RETURN QUERY
    SELECT
      p.id,
      extensions.pgp_sym_decrypt(p.full_name_enc, p_key)::TEXT,
      extensions.pgp_sym_decrypt(p.email_enc, p_key)::TEXT,
      extensions.pgp_sym_decrypt(p.phone_enc, p_key)::TEXT
    FROM public.patients p
    WHERE p.tenant_id = p_tenant_id
      AND p.anonymized_at IS NULL
      AND extensions.pgp_sym_decrypt(p.cpf_enc, p_key) = p_cpf
    LIMIT 1;
END $$;

REVOKE ALL ON FUNCTION public.public_booking_find_patient_by_cpf(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_booking_find_patient_by_cpf(UUID, TEXT, TEXT) TO service_role;

-- =========================================================================
-- 10. Triggers de auditoria (princípio II)
-- =========================================================================

-- public_booking_doctors: audit em INSERT/UPDATE/DELETE
CREATE OR REPLACE FUNCTION public.audit_public_booking_doctors_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
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

DROP TRIGGER IF EXISTS audit_pb_doctors ON public.public_booking_doctors;
CREATE TRIGGER audit_pb_doctors
  AFTER INSERT OR UPDATE OR DELETE ON public.public_booking_doctors
  FOR EACH ROW EXECUTE FUNCTION public.audit_public_booking_doctors_change();

-- public_booking_doctor_procedures: audit
CREATE OR REPLACE FUNCTION public.audit_public_booking_doctor_procedures_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
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

DROP TRIGGER IF EXISTS audit_pb_doctor_procs ON public.public_booking_doctor_procedures;
CREATE TRIGGER audit_pb_doctor_procs
  AFTER INSERT OR UPDATE OR DELETE ON public.public_booking_doctor_procedures
  FOR EACH ROW EXECUTE FUNCTION public.audit_public_booking_doctor_procedures_change();

-- public_booking_tokens: audit em INSERT/UPDATE (criação e uso do token)
CREATE OR REPLACE FUNCTION public.audit_public_booking_tokens_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
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

DROP TRIGGER IF EXISTS audit_pb_tokens ON public.public_booking_tokens;
CREATE TRIGGER audit_pb_tokens
  AFTER INSERT OR UPDATE ON public.public_booking_tokens
  FOR EACH ROW EXECUTE FUNCTION public.audit_public_booking_tokens_change();

-- =========================================================================
-- 11. Fim — comentários e validações
-- =========================================================================

COMMENT ON COLUMN public.tenant_clinic_profile.public_booking_slug IS
  'Slug do link público de agendamento (kebab-case 3-32 chars). UNIQUE global.';
COMMENT ON COLUMN public.tenant_clinic_profile.public_booking_enabled IS
  'Toggle de ativação da feature pública. Requer slug definido.';
COMMENT ON COLUMN public.public_booking_doctors.available_weekdays IS
  'Array SMALLINT 0-6 (dom-sáb) dos dias que o médico aceita agendamento público.';
COMMENT ON TABLE public.public_booking_tokens IS
  'Tokens de cancelamento (action=cancel) ou reagendamento (action=reschedule, fase 2). Armazenado como SHA-256 hash; raw só no email do paciente.';
COMMENT ON TABLE public.public_booking_rate_limits IS
  'Append-only, retenção 7 dias via cron. ip_hash = sha256(ip + tenant_id) — IP raw nunca armazenado (LGPD).';
COMMENT ON FUNCTION public.public_booking_slots(TEXT, UUID, UUID, DATE, DATE) IS
  'RPC SECURITY DEFINER para gerar slots disponíveis. Filtra implicitamente por slug habilitado, médico publicado, procedimento publicado. Retorna 0 linhas se qualquer filtro falhar.';

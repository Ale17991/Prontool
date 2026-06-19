-- 0134 — Feature 039: Odontograma Interativo (Módulo Odontológico — Fase 1).
-- (Renumerada de 0133 por colisão com 0133_clinic_calendar_window.sql.)
--
-- Conteúdo:
--   1. CREATE dental_status_catalog   — catálogo GLOBAL de status (sem tenant_id,
--      padrão tuss_codes); editável só por super-admin via service-role.
--   2. CREATE dental_chart_entries    — marcações por dente/face (per-tenant,
--      append-only). Correção = nova linha.
--   3. RPC dental_chart_current       — estado atual por posição (último registro).
--   4. SEED dos 10 status padrão.
--
-- Constituição:
--   - I (imutabilidade, por analogia): dental_chart_entries é append-only.
--   - II (auditabilidade): INSERT de marcação → log_audit_event. Catálogo é
--     entidade global (sem tenant_id) → auditoria por created_by/updated_by.
--   - III (multi-tenant): dental_chart_entries.tenant_id + RLS + triggers de
--     consistência paciente↔tenant e appointment↔tenant. Catálogo é referência
--     global read-only para authenticated (igual tuss_codes).
--   - IV (TUSS): status referencia opcionalmente tuss_codes (tabela 22).
--   - V (RBAC): INSERT de marcação só admin/profissional_saude.
--
-- Reversibilidade: aditiva, idempotente. supabase:reset recria.

-- =========================================================================
-- 1. dental_status_catalog — catálogo global (sem tenant_id, como tuss_codes)
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.dental_status_catalog (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9_]{1,47}$'),
  label         TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  color         TEXT NOT NULL CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  icon          TEXT NULL CHECK (icon IS NULL OR length(icon) <= 48),
  scope         TEXT NOT NULL CHECK (scope IN ('tooth', 'face', 'both')),
  tuss_code_id  UUID NULL REFERENCES public.tuss_codes(id) ON DELETE SET NULL,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  is_system     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.dental_status_catalog IS
  'Feature 039 — Catálogo GLOBAL de status do odontograma (FR-009/FR-014). Sem tenant_id (padrão tuss_codes). Editável só por super-admin via service-role. code/is_system imutáveis; is_system não pode ser desativado/removido.';

CREATE INDEX IF NOT EXISTS dental_status_catalog_palette_idx
  ON public.dental_status_catalog (is_active, sort_order);

ALTER TABLE public.dental_status_catalog ENABLE ROW LEVEL SECURITY;

-- Leitura para qualquer usuário autenticado (catálogo de referência global).
DROP POLICY IF EXISTS dental_status_catalog_read ON public.dental_status_catalog;
CREATE POLICY dental_status_catalog_read ON public.dental_status_catalog
  FOR SELECT TO authenticated
  USING (TRUE);

-- Escrita exclusiva do service-role (super-admin no /admin). Nenhuma policy de
-- INSERT/UPDATE/DELETE para authenticated.
REVOKE INSERT, UPDATE, DELETE ON public.dental_status_catalog FROM authenticated;
GRANT SELECT ON public.dental_status_catalog TO authenticated;

-- Guarda do catálogo: code imutável; is_system não pode ser desativado nem
-- removido (mesmo pelo service-role). Demais campos editáveis.
CREATE OR REPLACE FUNCTION public.enforce_dental_status_catalog_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_system THEN
      RAISE EXCEPTION 'dental_status_catalog: status de sistema (%) não pode ser removido', OLD.code
        USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE
  IF NEW.code <> OLD.code THEN
    RAISE EXCEPTION 'dental_status_catalog: code é imutável (% -> %)', OLD.code, NEW.code
      USING ERRCODE = '42501';
  END IF;
  IF OLD.is_system AND NEW.is_active = FALSE THEN
    RAISE EXCEPTION 'dental_status_catalog: status de sistema (%) não pode ser desativado', OLD.code
      USING ERRCODE = '42501';
  END IF;
  IF NEW.is_system <> OLD.is_system THEN
    RAISE EXCEPTION 'dental_status_catalog: is_system é imutável'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS dental_status_catalog_guard ON public.dental_status_catalog;
CREATE TRIGGER dental_status_catalog_guard
  BEFORE UPDATE OR DELETE ON public.dental_status_catalog
  FOR EACH ROW EXECUTE FUNCTION public.enforce_dental_status_catalog_guard();

-- Mantém updated_at coerente em qualquer UPDATE.
CREATE OR REPLACE FUNCTION public.touch_dental_status_catalog()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS dental_status_catalog_touch ON public.dental_status_catalog;
CREATE TRIGGER dental_status_catalog_touch
  BEFORE UPDATE ON public.dental_status_catalog
  FOR EACH ROW EXECUTE FUNCTION public.touch_dental_status_catalog();

-- =========================================================================
-- 2. dental_chart_entries — marcações por dente/face (per-tenant, append-only)
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.dental_chart_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  patient_id      UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  appointment_id  UUID NULL REFERENCES public.appointments(id) ON DELETE SET NULL,
  tooth_fdi       SMALLINT NOT NULL CHECK (
                    (tooth_fdi BETWEEN 11 AND 18) OR (tooth_fdi BETWEEN 21 AND 28) OR
                    (tooth_fdi BETWEEN 31 AND 38) OR (tooth_fdi BETWEEN 41 AND 48) OR
                    (tooth_fdi BETWEEN 51 AND 55) OR (tooth_fdi BETWEEN 61 AND 65) OR
                    (tooth_fdi BETWEEN 71 AND 75) OR (tooth_fdi BETWEEN 81 AND 85)
                  ),
  surface         TEXT NULL CHECK (
                    surface IS NULL OR
                    surface IN ('mesial', 'distal', 'occlusal_incisal', 'vestibular', 'lingual_palatal')
                  ),
  status_id       UUID NOT NULL REFERENCES public.dental_status_catalog(id) ON DELETE RESTRICT,
  note            TEXT NULL CHECK (note IS NULL OR length(note) <= 2000),
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.dental_chart_entries IS
  'Feature 039 — Marcações do odontograma por dente/face (FR-016/FR-017). Append-only: correção/limpeza = nova linha. Estado atual = último por (tooth_fdi, surface).';

CREATE INDEX IF NOT EXISTS dental_chart_entries_position_idx
  ON public.dental_chart_entries (tenant_id, patient_id, tooth_fdi, surface, recorded_at DESC);

CREATE INDEX IF NOT EXISTS dental_chart_entries_appointment_idx
  ON public.dental_chart_entries (tenant_id, appointment_id);

-- Append-only: nenhum UPDATE/DELETE (sem whitelist).
DROP TRIGGER IF EXISTS dental_chart_entries_append_only ON public.dental_chart_entries;
CREATE TRIGGER dental_chart_entries_append_only
  BEFORE UPDATE OR DELETE ON public.dental_chart_entries
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only_columns('');

-- Consistência BEFORE INSERT: paciente e appointment pertencem ao tenant +
-- coerência escopo↔surface contra o status.
CREATE OR REPLACE FUNCTION public.check_dental_chart_entry()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_patient_tenant     UUID;
  v_appointment_tenant UUID;
  v_appointment_patient UUID;
  v_scope              TEXT;
BEGIN
  -- Paciente pertence ao tenant.
  SELECT tenant_id INTO v_patient_tenant
    FROM public.patients WHERE id = NEW.patient_id;
  IF v_patient_tenant IS NULL THEN
    RAISE EXCEPTION 'dental_chart_entries: paciente % não encontrado', NEW.patient_id
      USING ERRCODE = '23503';
  END IF;
  IF v_patient_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'DENTAL_TENANT_MISMATCH: patient.tenant_id (%) <> entry.tenant_id (%)',
      v_patient_tenant, NEW.tenant_id USING ERRCODE = '42501';
  END IF;

  -- Appointment (se informado) pertence ao tenant e ao paciente.
  IF NEW.appointment_id IS NOT NULL THEN
    SELECT tenant_id, patient_id INTO v_appointment_tenant, v_appointment_patient
      FROM public.appointments WHERE id = NEW.appointment_id;
    IF v_appointment_tenant IS NULL THEN
      RAISE EXCEPTION 'dental_chart_entries: appointment % não encontrado', NEW.appointment_id
        USING ERRCODE = '23503';
    END IF;
    IF v_appointment_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'DENTAL_TENANT_MISMATCH: appointment.tenant_id (%) <> entry.tenant_id (%)',
        v_appointment_tenant, NEW.tenant_id USING ERRCODE = '42501';
    END IF;
    IF v_appointment_patient <> NEW.patient_id THEN
      RAISE EXCEPTION 'DENTAL_APPOINTMENT_PATIENT_MISMATCH: appointment não é do paciente %', NEW.patient_id
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Coerência escopo↔surface contra o status do catálogo.
  SELECT scope INTO v_scope
    FROM public.dental_status_catalog WHERE id = NEW.status_id;
  IF v_scope IS NULL THEN
    RAISE EXCEPTION 'dental_chart_entries: status % não encontrado', NEW.status_id
      USING ERRCODE = '23503';
  END IF;
  IF v_scope = 'tooth' AND NEW.surface IS NOT NULL THEN
    RAISE EXCEPTION 'DENTAL_SCOPE_MISMATCH: status de escopo dente não aceita surface'
      USING ERRCODE = '23514';
  END IF;
  IF v_scope = 'face' AND NEW.surface IS NULL THEN
    RAISE EXCEPTION 'DENTAL_SCOPE_MISMATCH: status de escopo face exige surface'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS dental_chart_entries_check ON public.dental_chart_entries;
CREATE TRIGGER dental_chart_entries_check
  BEFORE INSERT ON public.dental_chart_entries
  FOR EACH ROW EXECUTE FUNCTION public.check_dental_chart_entry();

-- Auditoria AFTER INSERT (Princípio II).
CREATE OR REPLACE FUNCTION public.audit_dental_chart_entry_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.log_audit_event(
    NEW.tenant_id,
    'dental_chart_entries',
    NEW.id,
    'created',
    NULL,
    json_build_object(
      'patient_id',     NEW.patient_id,
      'appointment_id', NEW.appointment_id,
      'tooth_fdi',      NEW.tooth_fdi,
      'surface',        NEW.surface,
      'status_id',      NEW.status_id,
      'created_by',     NEW.created_by
    )::text,
    'feature 039 — marcação odontográfica criada'
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS dental_chart_entries_audit ON public.dental_chart_entries;
CREATE TRIGGER dental_chart_entries_audit
  AFTER INSERT ON public.dental_chart_entries
  FOR EACH ROW EXECUTE FUNCTION public.audit_dental_chart_entry_insert();

ALTER TABLE public.dental_chart_entries ENABLE ROW LEVEL SECURITY;

-- Staff: SELECT por tenant; INSERT só admin/profissional_saude (FR-021).
DROP POLICY IF EXISTS dental_chart_entries_tenant_read ON public.dental_chart_entries;
CREATE POLICY dental_chart_entries_tenant_read ON public.dental_chart_entries
  FOR SELECT TO authenticated
  USING (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS dental_chart_entries_clinical_insert ON public.dental_chart_entries;
CREATE POLICY dental_chart_entries_clinical_insert ON public.dental_chart_entries
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() IN ('admin', 'profissional_saude')
  );

GRANT SELECT, INSERT ON public.dental_chart_entries TO authenticated;

-- =========================================================================
-- 3. RPC dental_chart_current — estado atual por posição (último registro)
-- =========================================================================

CREATE OR REPLACE FUNCTION public.dental_chart_current(
  p_tenant_id  UUID,
  p_patient_id UUID
) RETURNS TABLE (
  id              UUID,
  tooth_fdi       SMALLINT,
  surface         TEXT,
  status_id       UUID,
  note            TEXT,
  recorded_at     TIMESTAMPTZ,
  appointment_id  UUID,
  created_by      UUID
) LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_jwt_tenant UUID;
BEGIN
  -- Quando chamada por usuário autenticado, exige match de tenant (defesa em
  -- camadas; o service-role passa jwt nulo e confia no p_tenant_id da rota).
  v_jwt_tenant := public.jwt_tenant_id();
  IF v_jwt_tenant IS NOT NULL AND v_jwt_tenant <> p_tenant_id THEN
    RAISE EXCEPTION 'TENANT_MISMATCH' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT DISTINCT ON (e.tooth_fdi, e.surface)
           e.id, e.tooth_fdi, e.surface, e.status_id, e.note,
           e.recorded_at, e.appointment_id, e.created_by
      FROM public.dental_chart_entries e
     WHERE e.tenant_id = p_tenant_id
       AND e.patient_id = p_patient_id
     ORDER BY e.tooth_fdi, e.surface, e.recorded_at DESC;
END $$;

REVOKE ALL ON FUNCTION public.dental_chart_current(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dental_chart_current(UUID, UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.dental_chart_current IS
  'Feature 039 — Estado atual do odontograma: último registro por (tooth_fdi, surface). DEFINER com guarda de tenant para authenticated.';

-- =========================================================================
-- 4. Seed dos status padrão (idempotente)
-- =========================================================================

INSERT INTO public.dental_status_catalog
  (code, label, color, icon, scope, sort_order, is_active, is_system)
VALUES
  ('none',                 'Sem registro',        '#e5e7eb', NULL,       'both',  0,  TRUE, TRUE),
  ('caries',               'Cárie',               '#dc2626', 'bug',      'face',  10, TRUE, FALSE),
  ('restoration',          'Restauração',         '#2563eb', 'square',   'face',  20, TRUE, FALSE),
  ('sealant',              'Selante',             '#16a34a', 'shield',   'face',  30, TRUE, FALSE),
  ('fracture',             'Fratura',             '#ea580c', 'zap',      'face',  40, TRUE, FALSE),
  ('missing',              'Ausente',             '#6b7280', 'x',        'tooth', 50, TRUE, FALSE),
  ('implant',              'Implante',            '#7c3aed', 'anchor',   'tooth', 60, TRUE, FALSE),
  ('crown',                'Coroa',               '#d97706', 'crown',    'tooth', 70, TRUE, FALSE),
  ('extraction_indicated', 'Extração indicada',   '#991b1b', 'scissors', 'tooth', 80, TRUE, FALSE),
  ('root_canal',           'Tratamento de canal', '#0891b2', 'syringe',  'tooth', 90, TRUE, FALSE)
ON CONFLICT (code) DO NOTHING;

-- =========================================================================
-- Done.
-- =========================================================================

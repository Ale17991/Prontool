-- 0161 — Feature 041: Periograma (periodontograma) — Módulo Odontológico Fase 3.
--
-- Exame periodontal de boca toda, datado, com ciclo rascunho→finalizado
-- (imutável após finalizar — padrão de treatment_budgets, 0160). Reaproveita a
-- notação FDI do odontograma. 6 sítios por dente.
--
-- Tabelas: perio_exams (cabeçalho), perio_site_measurements (6 sítios/dente),
--          perio_tooth_findings (mobilidade/furca/ausente/implante).
-- RPC:     perio_exam_indicators (BOP%, bolsas ≥4mm, CAL médio).
--
-- Constituição:
--   I  (por analogia): exame finalizado é imutável (triggers de congelamento).
--   II: auditoria de criação/finalização via log_audit_event.
--   III: tenant_id + RLS + consistência paciente/atendimento↔tenant.
--   V: escrita só admin/profissional_saude.
--
-- Aditiva e idempotente.

-- =========================================================================
-- 1. perio_exams — cabeçalho do exame
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.perio_exams (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  patient_id     UUID NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  appointment_id UUID NULL REFERENCES public.appointments(id) ON DELETE SET NULL,
  exam_date      DATE NOT NULL DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,
  status         TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'finalizado')),
  dentition      TEXT NOT NULL DEFAULT 'permanent' CHECK (dentition IN ('permanent', 'deciduous')),
  notes          TEXT NULL CHECK (notes IS NULL OR length(notes) <= 2000),
  finalized_at   TIMESTAMPTZ NULL,
  finalized_by   UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by     UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.perio_exams IS
  'Feature 041 — Exame periodontal de boca toda, datado. Ciclo rascunho→finalizado; finalizado é imutável (snapshot histórico).';

CREATE INDEX IF NOT EXISTS perio_exams_patient_idx
  ON public.perio_exams (tenant_id, patient_id, exam_date DESC);

-- Um rascunho por paciente (D5/FR-018).
CREATE UNIQUE INDEX IF NOT EXISTS perio_exams_one_draft_idx
  ON public.perio_exams (tenant_id, patient_id) WHERE status = 'rascunho';

-- Consistência BEFORE INSERT: paciente e atendimento pertencem ao tenant.
CREATE OR REPLACE FUNCTION public.check_perio_exam()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_patient_tenant      UUID;
  v_appointment_tenant  UUID;
  v_appointment_patient UUID;
BEGIN
  SELECT tenant_id INTO v_patient_tenant FROM public.patients WHERE id = NEW.patient_id;
  IF v_patient_tenant IS NULL THEN
    RAISE EXCEPTION 'perio_exams: paciente % não encontrado', NEW.patient_id USING ERRCODE = '23503';
  END IF;
  IF v_patient_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'PERIO_TENANT_MISMATCH: patient.tenant_id (%) <> exam.tenant_id (%)',
      v_patient_tenant, NEW.tenant_id USING ERRCODE = '42501';
  END IF;

  IF NEW.appointment_id IS NOT NULL THEN
    SELECT tenant_id, patient_id INTO v_appointment_tenant, v_appointment_patient
      FROM public.appointments WHERE id = NEW.appointment_id;
    IF v_appointment_tenant IS NULL THEN
      RAISE EXCEPTION 'perio_exams: appointment % não encontrado', NEW.appointment_id USING ERRCODE = '23503';
    END IF;
    IF v_appointment_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'PERIO_TENANT_MISMATCH: appointment.tenant_id (%) <> exam.tenant_id (%)',
        v_appointment_tenant, NEW.tenant_id USING ERRCODE = '42501';
    END IF;
    IF v_appointment_patient <> NEW.patient_id THEN
      RAISE EXCEPTION 'PERIO_APPOINTMENT_PATIENT_MISMATCH: atendimento não é do paciente %', NEW.patient_id
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS perio_exams_check ON public.perio_exams;
CREATE TRIGGER perio_exams_check
  BEFORE INSERT ON public.perio_exams
  FOR EACH ROW EXECUTE FUNCTION public.check_perio_exam();

-- Ciclo de status + núcleo imutável (BEFORE UPDATE).
CREATE OR REPLACE FUNCTION public.enforce_perio_exam_update()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id         IS DISTINCT FROM OLD.id
     OR NEW.tenant_id  IS DISTINCT FROM OLD.tenant_id
     OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING MESSAGE = 'perio_exams: campos de núcleo são imutáveis', ERRCODE = '42501';
  END IF;

  IF OLD.status = 'finalizado' THEN
    RAISE EXCEPTION USING MESSAGE = 'perio_exams: exame finalizado é imutável', ERRCODE = '42501';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (OLD.status = 'rascunho' AND NEW.status = 'finalizado') THEN
      RAISE EXCEPTION USING
        MESSAGE = format('perio_exams: transição %s → %s inválida', OLD.status, NEW.status),
        ERRCODE = '42501';
    END IF;
    IF NEW.finalized_at IS NULL OR NEW.finalized_by IS NULL THEN
      RAISE EXCEPTION USING
        MESSAGE = 'perio_exams: finalização exige finalized_at e finalized_by', ERRCODE = '42501';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS perio_exams_update_guard ON public.perio_exams;
CREATE TRIGGER perio_exams_update_guard
  BEFORE UPDATE ON public.perio_exams
  FOR EACH ROW EXECUTE FUNCTION public.enforce_perio_exam_update();

-- DELETE só de rascunho (descarte); finalizado não pode ser apagado.
CREATE OR REPLACE FUNCTION public.enforce_perio_exam_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'rascunho' THEN
    RAISE EXCEPTION USING MESSAGE = 'perio_exams: só rascunho pode ser descartado', ERRCODE = '42501';
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS perio_exams_delete_guard ON public.perio_exams;
CREATE TRIGGER perio_exams_delete_guard
  BEFORE DELETE ON public.perio_exams
  FOR EACH ROW EXECUTE FUNCTION public.enforce_perio_exam_delete();

-- Auditoria (created + finalização).
CREATE OR REPLACE FUNCTION public.audit_perio_exam_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'perio_exams', NEW.id, 'status', NULL, NEW.status, 'feature 041 — exame periodontal criado');
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'perio_exams', NEW.id, 'status', OLD.status, NEW.status, 'feature 041 — exame periodontal finalizado');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS perio_exams_audit ON public.perio_exams;
CREATE TRIGGER perio_exams_audit
  AFTER INSERT OR UPDATE ON public.perio_exams
  FOR EACH ROW EXECUTE FUNCTION public.audit_perio_exam_change();

-- =========================================================================
-- 2. perio_site_measurements — 6 sítios por dente
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.perio_site_measurements (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  exam_id          UUID NOT NULL REFERENCES public.perio_exams(id) ON DELETE CASCADE,
  tooth_fdi        SMALLINT NOT NULL CHECK (
                     (tooth_fdi BETWEEN 11 AND 18) OR (tooth_fdi BETWEEN 21 AND 28) OR
                     (tooth_fdi BETWEEN 31 AND 38) OR (tooth_fdi BETWEEN 41 AND 48) OR
                     (tooth_fdi BETWEEN 51 AND 55) OR (tooth_fdi BETWEEN 61 AND 65) OR
                     (tooth_fdi BETWEEN 71 AND 75) OR (tooth_fdi BETWEEN 81 AND 85)
                   ),
  site             TEXT NOT NULL CHECK (site IN ('db', 'b', 'mb', 'dl', 'l', 'ml')),
  probing_depth_mm SMALLINT NULL CHECK (probing_depth_mm IS NULL OR probing_depth_mm BETWEEN 0 AND 15),
  recession_mm     SMALLINT NULL CHECK (recession_mm IS NULL OR recession_mm BETWEEN -5 AND 15),
  bleeding         BOOLEAN NOT NULL DEFAULT FALSE,
  suppuration      BOOLEAN NOT NULL DEFAULT FALSE,
  plaque           BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT perio_site_measurements_uniq UNIQUE (exam_id, tooth_fdi, site)
);

COMMENT ON TABLE public.perio_site_measurements IS
  'Feature 041 — Medição por sítio (6/dente). CAL derivado = probing_depth_mm + recession_mm (recessão com sinal).';

CREATE INDEX IF NOT EXISTS perio_site_measurements_exam_idx
  ON public.perio_site_measurements (exam_id);

-- =========================================================================
-- 3. perio_tooth_findings — achados por dente
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.perio_tooth_findings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  exam_id     UUID NOT NULL REFERENCES public.perio_exams(id) ON DELETE CASCADE,
  tooth_fdi   SMALLINT NOT NULL CHECK (
                (tooth_fdi BETWEEN 11 AND 18) OR (tooth_fdi BETWEEN 21 AND 28) OR
                (tooth_fdi BETWEEN 31 AND 38) OR (tooth_fdi BETWEEN 41 AND 48) OR
                (tooth_fdi BETWEEN 51 AND 55) OR (tooth_fdi BETWEEN 61 AND 65) OR
                (tooth_fdi BETWEEN 71 AND 75) OR (tooth_fdi BETWEEN 81 AND 85)
              ),
  mobility    SMALLINT NULL CHECK (mobility IS NULL OR mobility BETWEEN 0 AND 3),
  furcation   SMALLINT NULL CHECK (furcation IS NULL OR furcation BETWEEN 1 AND 3),
  is_missing  BOOLEAN NOT NULL DEFAULT FALSE,
  is_implant  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT perio_tooth_findings_uniq UNIQUE (exam_id, tooth_fdi)
);

COMMENT ON TABLE public.perio_tooth_findings IS
  'Feature 041 — Achados por dente no exame: mobilidade (0–3), furca (I–III), ausente, implante.';

CREATE INDEX IF NOT EXISTS perio_tooth_findings_exam_idx
  ON public.perio_tooth_findings (exam_id);

-- =========================================================================
-- 4. Triggers comuns aos filhos: consistência de tenant + congelamento
-- =========================================================================

-- Copia/confere o tenant do exame e exige que o exame esteja em rascunho.
CREATE OR REPLACE FUNCTION public.check_perio_child()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_exam_tenant UUID;
  v_exam_status TEXT;
BEGIN
  SELECT tenant_id, status INTO v_exam_tenant, v_exam_status
    FROM public.perio_exams WHERE id = NEW.exam_id;
  IF v_exam_tenant IS NULL THEN
    RAISE EXCEPTION 'perio child: exame % não encontrado', NEW.exam_id USING ERRCODE = '23503';
  END IF;
  -- herda o tenant do exame (fonte de verdade).
  NEW.tenant_id := v_exam_tenant;
  IF v_exam_status <> 'rascunho' THEN
    RAISE EXCEPTION USING
      MESSAGE = 'perio: exame não está em rascunho — medições/achados imutáveis', ERRCODE = '42501';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- Bloqueia DELETE de filhos quando o exame não está em rascunho.
CREATE OR REPLACE FUNCTION public.check_perio_child_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_exam_status TEXT;
BEGIN
  SELECT status INTO v_exam_status FROM public.perio_exams WHERE id = OLD.exam_id;
  -- exame já apagado (CASCADE) → permite; senão exige rascunho.
  IF v_exam_status IS NOT NULL AND v_exam_status <> 'rascunho' THEN
    RAISE EXCEPTION USING
      MESSAGE = 'perio: exame não está em rascunho — não pode remover medições/achados', ERRCODE = '42501';
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS perio_site_measurements_guard ON public.perio_site_measurements;
CREATE TRIGGER perio_site_measurements_guard
  BEFORE INSERT OR UPDATE ON public.perio_site_measurements
  FOR EACH ROW EXECUTE FUNCTION public.check_perio_child();

DROP TRIGGER IF EXISTS perio_site_measurements_delete_guard ON public.perio_site_measurements;
CREATE TRIGGER perio_site_measurements_delete_guard
  BEFORE DELETE ON public.perio_site_measurements
  FOR EACH ROW EXECUTE FUNCTION public.check_perio_child_delete();

DROP TRIGGER IF EXISTS perio_tooth_findings_guard ON public.perio_tooth_findings;
CREATE TRIGGER perio_tooth_findings_guard
  BEFORE INSERT OR UPDATE ON public.perio_tooth_findings
  FOR EACH ROW EXECUTE FUNCTION public.check_perio_child();

DROP TRIGGER IF EXISTS perio_tooth_findings_delete_guard ON public.perio_tooth_findings;
CREATE TRIGGER perio_tooth_findings_delete_guard
  BEFORE DELETE ON public.perio_tooth_findings
  FOR EACH ROW EXECUTE FUNCTION public.check_perio_child_delete();

-- =========================================================================
-- 5. RLS — as três tabelas (leitura por papéis do tenant; escrita só clínica)
-- =========================================================================

ALTER TABLE public.perio_exams              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.perio_site_measurements  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.perio_tooth_findings     ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['perio_exams', 'perio_site_measurements', 'perio_tooth_findings'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_read ON public.%I', t, t);
    EXECUTE format($p$
      CREATE POLICY %I_read ON public.%I FOR SELECT TO authenticated
      USING (tenant_id = public.jwt_tenant_id()
             AND public.jwt_role() IN ('admin','financeiro','recepcionista','profissional_saude'))
    $p$, t, t);

    EXECUTE format('DROP POLICY IF EXISTS %I_insert ON public.%I', t, t);
    EXECUTE format($p$
      CREATE POLICY %I_insert ON public.%I FOR INSERT TO authenticated
      WITH CHECK (tenant_id = public.jwt_tenant_id()
                  AND public.jwt_role() IN ('admin','profissional_saude'))
    $p$, t, t);

    EXECUTE format('DROP POLICY IF EXISTS %I_update ON public.%I', t, t);
    EXECUTE format($p$
      CREATE POLICY %I_update ON public.%I FOR UPDATE TO authenticated
      USING (tenant_id = public.jwt_tenant_id()
             AND public.jwt_role() IN ('admin','profissional_saude'))
    $p$, t, t);

    EXECUTE format('DROP POLICY IF EXISTS %I_delete ON public.%I', t, t);
    EXECUTE format($p$
      CREATE POLICY %I_delete ON public.%I FOR DELETE TO authenticated
      USING (tenant_id = public.jwt_tenant_id()
             AND public.jwt_role() IN ('admin','profissional_saude'))
    $p$, t, t);

    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END $$;

-- =========================================================================
-- 6. RPC perio_exam_indicators — agregados (BOP%, bolsas ≥4mm, CAL médio)
-- =========================================================================

CREATE OR REPLACE FUNCTION public.perio_exam_indicators(
  p_tenant_id UUID,
  p_exam_id   UUID
) RETURNS TABLE (
  sites_measured   INT,
  sites_bleeding   INT,
  bop_pct          NUMERIC,
  pockets_ge4      INT,
  pockets_ge4_pct  NUMERIC,
  cal_avg_mm       NUMERIC
) LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_jwt_tenant UUID;
BEGIN
  v_jwt_tenant := public.jwt_tenant_id();
  IF v_jwt_tenant IS NOT NULL AND v_jwt_tenant <> p_tenant_id THEN
    RAISE EXCEPTION 'TENANT_MISMATCH' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH present AS (
    -- dentes ausentes saem dos cálculos.
    SELECT m.*
      FROM public.perio_site_measurements m
      JOIN public.perio_exams e ON e.id = m.exam_id
      LEFT JOIN public.perio_tooth_findings f
        ON f.exam_id = m.exam_id AND f.tooth_fdi = m.tooth_fdi
     WHERE m.exam_id = p_exam_id
       AND e.tenant_id = p_tenant_id
       AND COALESCE(f.is_missing, FALSE) = FALSE
       AND m.probing_depth_mm IS NOT NULL
  )
  SELECT
    COUNT(*)::INT,
    COUNT(*) FILTER (WHERE bleeding)::INT,
    ROUND(100.0 * COUNT(*) FILTER (WHERE bleeding) / NULLIF(COUNT(*), 0), 1),
    COUNT(*) FILTER (WHERE probing_depth_mm >= 4)::INT,
    ROUND(100.0 * COUNT(*) FILTER (WHERE probing_depth_mm >= 4) / NULLIF(COUNT(*), 0), 1),
    ROUND(AVG(probing_depth_mm + COALESCE(recession_mm, 0))::NUMERIC, 1)
  FROM present;
END $$;

REVOKE ALL ON FUNCTION public.perio_exam_indicators(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.perio_exam_indicators(UUID, UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.perio_exam_indicators IS
  'Feature 041 — Indicadores agregados do exame: BOP%, bolsas ≥4mm, CAL médio. Ignora dentes ausentes e sítios não medidos. DEFINER com guarda de tenant.';

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- Done.
-- =========================================================================

-- 0052 — Sinais vitais do paciente.
--
-- Append-only. IMC calculado como GENERATED ALWAYS AS STORED (cálculo
-- automático no banco; consistência sem trigger). Peso em gramas pra
-- precisão (60500 = 60.5kg) e altura em cm.

CREATE TABLE IF NOT EXISTS public.vital_signs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  patient_id           UUID NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  appointment_id       UUID REFERENCES public.appointments(id) ON DELETE RESTRICT,
  measured_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  systolic_bp          INT CHECK (systolic_bp IS NULL OR systolic_bp BETWEEN 40 AND 300),
  diastolic_bp         INT CHECK (diastolic_bp IS NULL OR diastolic_bp BETWEEN 20 AND 200),
  heart_rate           INT CHECK (heart_rate IS NULL OR heart_rate BETWEEN 20 AND 300),
  respiratory_rate     INT CHECK (respiratory_rate IS NULL OR respiratory_rate BETWEEN 5 AND 80),
  temperature_celsius  NUMERIC(4,1) CHECK (temperature_celsius IS NULL OR temperature_celsius BETWEEN 25.0 AND 45.0),
  oxygen_saturation    INT CHECK (oxygen_saturation IS NULL OR oxygen_saturation BETWEEN 50 AND 100),
  weight_grams         INT CHECK (weight_grams IS NULL OR weight_grams BETWEEN 500 AND 500000),
  height_cm            INT CHECK (height_cm IS NULL OR height_cm BETWEEN 30 AND 260),
  bmi                  NUMERIC(4,1) GENERATED ALWAYS AS (
    CASE WHEN weight_grams > 0 AND height_cm > 0
      THEN ROUND((weight_grams::numeric / 1000) / ((height_cm::numeric / 100) ^ 2), 1)
      ELSE NULL
    END
  ) STORED,
  notes                TEXT,
  measured_by          UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vital_signs_patient_idx
  ON public.vital_signs (tenant_id, patient_id, measured_at DESC);
CREATE INDEX IF NOT EXISTS vital_signs_appointment_idx
  ON public.vital_signs (tenant_id, appointment_id)
  WHERE appointment_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_vital_signs_mutability()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'vital_signs: rows are immutable. Insert a new measurement.';
END $$;

DROP TRIGGER IF EXISTS vital_signs_immutable ON public.vital_signs;
CREATE TRIGGER vital_signs_immutable
  BEFORE UPDATE ON public.vital_signs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_vital_signs_mutability();

DROP TRIGGER IF EXISTS vital_signs_no_delete ON public.vital_signs;
CREATE TRIGGER vital_signs_no_delete
  BEFORE DELETE ON public.vital_signs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only();

CREATE OR REPLACE FUNCTION public.audit_vital_signs_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'vital_signs', NEW.id,
      'measured_at', NULL, NEW.measured_at::text, 'vital-signs-recorded'
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS vital_signs_audit ON public.vital_signs;
CREATE TRIGGER vital_signs_audit
  AFTER INSERT ON public.vital_signs
  FOR EACH ROW EXECUTE FUNCTION public.audit_vital_signs_change();

ALTER TABLE public.vital_signs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vital_signs_read ON public.vital_signs;
CREATE POLICY vital_signs_read ON public.vital_signs FOR SELECT
  USING (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS vital_signs_write_insert ON public.vital_signs;
CREATE POLICY vital_signs_write_insert ON public.vital_signs FOR INSERT
  WITH CHECK (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() IN ('admin', 'profissional_saude')
  );

GRANT SELECT, INSERT ON public.vital_signs TO authenticated;

NOTIFY pgrst, 'reload schema';

-- 0145 — Exame oftalmológico estruturado (backlog 2, módulo oftalmologia).
--
-- Consulta oftalmo: acuidade visual (SC/CC por olho), refração, PIO,
-- biomicroscopia, fundoscopia e conduta. Valores como TEXT (AV "20/20",
-- PIO "14", refração "-1.25"). PDF sob demanda. Aditiva e idempotente.

CREATE TABLE IF NOT EXISTS public.ophthalmology_exams (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  patient_id    UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  doctor_id     UUID NULL REFERENCES public.doctors(id),
  exam_date     DATE NOT NULL DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,
  -- Acuidade visual: sem correção (SC) e com correção (CC)
  av_od_sc      TEXT NULL, av_od_cc TEXT NULL,
  av_oe_sc      TEXT NULL, av_oe_cc TEXT NULL,
  -- Refração
  refr_od_sphere TEXT NULL, refr_od_cylinder TEXT NULL, refr_od_axis TEXT NULL,
  refr_oe_sphere TEXT NULL, refr_oe_cylinder TEXT NULL, refr_oe_axis TEXT NULL,
  -- Pressão intraocular (mmHg)
  pio_od        TEXT NULL, pio_oe TEXT NULL,
  biomicroscopy TEXT NULL CHECK (biomicroscopy IS NULL OR char_length(biomicroscopy) <= 4000),
  fundoscopy    TEXT NULL CHECK (fundoscopy IS NULL OR char_length(fundoscopy) <= 4000),
  notes         TEXT NULL CHECK (notes IS NULL OR char_length(notes) <= 4000),
  issued_at     TIMESTAMPTZ NULL,
  created_by    UUID NOT NULL REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ NULL,
  deleted_by    UUID NULL REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS ophthalmology_exams_patient_idx
  ON public.ophthalmology_exams (tenant_id, patient_id, exam_date DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE public.ophthalmology_exams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ophthalmology_exams_read ON public.ophthalmology_exams;
CREATE POLICY ophthalmology_exams_read ON public.ophthalmology_exams
  FOR SELECT USING (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS ophthalmology_exams_write ON public.ophthalmology_exams;
CREATE POLICY ophthalmology_exams_write ON public.ophthalmology_exams
  FOR ALL
  USING  (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN ('admin', 'profissional_saude'))
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN ('admin', 'profissional_saude'));

COMMENT ON TABLE public.ophthalmology_exams IS
  'Backlog 2 — exame oftalmológico estruturado (AV, refração, PIO, biomicroscopia, fundoscopia).';

NOTIFY pgrst, 'reload schema';

-- 0211 — Fotos de evolução do paciente (antes/depois).
--
-- A foto que já existia (`patients.photo_path`, migration 0137) é o RETRATO do
-- cadastro: uma só, substituída a cada envio. Comparar antes/depois pede o
-- oposto — uma SÉRIE que cresce e da qual nada é sobrescrito —, por isso tabela
-- própria em vez de esticar a coluna.
--
-- `angle` (o ângulo) existe porque a comparação automática é "a primeira contra
-- a última": sem agrupar por ângulo, o par sai uma foto de frente contra uma de
-- perfil e a montagem não quer dizer nada.
--
-- `taken_on` é DATE e é separado de `uploaded_at`: a clínica sobe hoje a foto
-- tirada há seis meses, e é a data do REGISTRO que ordena a série.
--
-- Próximo número livre (última é a 0210). Aditiva e idempotente.

CREATE TABLE IF NOT EXISTS public.patient_progress_photos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  patient_id      UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  storage_path    TEXT NOT NULL,
  angle            TEXT NOT NULL DEFAULT 'frente'
                    CHECK (angle IN ('frente', 'perfil_direito', 'perfil_esquerdo', 'costas', 'outro')),
  taken_on        DATE NOT NULL,
  note            TEXT NULL CHECK (note IS NULL OR char_length(note) <= 300),
  content_type    TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL,
  uploaded_by     UUID NOT NULL REFERENCES auth.users(id),
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ NULL,
  deleted_by      UUID NULL REFERENCES auth.users(id)
);

-- A leitura é sempre "a série deste paciente, deste ângulo, em ordem de data".
CREATE INDEX IF NOT EXISTS patient_progress_photos_series_idx
  ON public.patient_progress_photos (tenant_id, patient_id, angle, taken_on)
  WHERE deleted_at IS NULL;

ALTER TABLE public.patient_progress_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS patient_progress_photos_read ON public.patient_progress_photos;
CREATE POLICY patient_progress_photos_read ON public.patient_progress_photos
  FOR SELECT USING (tenant_id = public.jwt_tenant_id());

-- Quem fotografa é quem atende OU a recepção — espelha 0144, não a 0137 (que
-- deixa a foto do cadastro fora do alcance do profissional de saúde).
DROP POLICY IF EXISTS patient_progress_photos_write ON public.patient_progress_photos;
CREATE POLICY patient_progress_photos_write ON public.patient_progress_photos
  FOR ALL
  USING  (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN ('admin', 'recepcionista', 'profissional_saude'))
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN ('admin', 'recepcionista', 'profissional_saude'));

-- Bucket privado próprio. Reusar `patient-photos` obrigaria a afrouxar as
-- policies dela (hoje sem profissional_saude na escrita) e o retrato do
-- cadastro passaria a ser editável por quem não devia.
INSERT INTO storage.buckets (id, name, public)
VALUES ('patient-progress-photos', 'patient-progress-photos', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS progress_photos_tenant_read ON storage.objects;
CREATE POLICY progress_photos_tenant_read
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'patient-progress-photos'
    AND (storage.foldername(name))[1] = public.jwt_tenant_id()::text
  );

DROP POLICY IF EXISTS progress_photos_staff_insert ON storage.objects;
CREATE POLICY progress_photos_staff_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'patient-progress-photos'
    AND (storage.foldername(name))[1] = public.jwt_tenant_id()::text
    AND public.jwt_role() IN ('admin', 'recepcionista', 'profissional_saude')
  );

DROP POLICY IF EXISTS progress_photos_staff_delete ON storage.objects;
CREATE POLICY progress_photos_staff_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'patient-progress-photos'
    AND (storage.foldername(name))[1] = public.jwt_tenant_id()::text
    AND public.jwt_role() IN ('admin', 'recepcionista', 'profissional_saude')
  );

COMMENT ON TABLE public.patient_progress_photos IS
  'Série de fotos de evolução do paciente (antes/depois). Agrupada por ângulo; ordenada por taken_on, não por upload.';

NOTIFY pgrst, 'reload schema';

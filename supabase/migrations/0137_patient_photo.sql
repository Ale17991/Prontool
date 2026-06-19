-- 0137 — Foto na ficha do paciente (backlog 1/1).
--
-- Colunas em patients + bucket privado `patient-photos`. Path =
-- {tenant_id}/{patient_id}.{ext} (tenant no 1º segmento p/ RLS). Espelha o
-- padrão de `user-avatars` (migration 0064). Upload via service-role (API);
-- as policies são defesa em profundidade. Aditiva e idempotente.

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS photo_path TEXT NULL,
  ADD COLUMN IF NOT EXISTS photo_uploaded_at TIMESTAMPTZ NULL;

INSERT INTO storage.buckets (id, name, public)
VALUES ('patient-photos', 'patient-photos', false)
ON CONFLICT (id) DO NOTHING;

-- Read: qualquer autenticado do mesmo tenant.
DROP POLICY IF EXISTS patient_photos_tenant_read ON storage.objects;
CREATE POLICY patient_photos_tenant_read
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'patient-photos'
    AND (storage.foldername(name))[1] = public.jwt_tenant_id()::text
  );

-- Write/Update/Delete: admin ou recepcionista do mesmo tenant.
DROP POLICY IF EXISTS patient_photos_staff_insert ON storage.objects;
CREATE POLICY patient_photos_staff_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'patient-photos'
    AND (storage.foldername(name))[1] = public.jwt_tenant_id()::text
    AND public.jwt_role() IN ('admin', 'recepcionista')
  );

DROP POLICY IF EXISTS patient_photos_staff_update ON storage.objects;
CREATE POLICY patient_photos_staff_update
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'patient-photos'
    AND (storage.foldername(name))[1] = public.jwt_tenant_id()::text
    AND public.jwt_role() IN ('admin', 'recepcionista')
  );

DROP POLICY IF EXISTS patient_photos_staff_delete ON storage.objects;
CREATE POLICY patient_photos_staff_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'patient-photos'
    AND (storage.foldername(name))[1] = public.jwt_tenant_id()::text
    AND public.jwt_role() IN ('admin', 'recepcionista')
  );

COMMENT ON COLUMN public.patients.photo_path IS
  'Backlog 1/1 — caminho da foto no bucket patient-photos ({tenant}/{patient}.ext).';

NOTIFY pgrst, 'reload schema';

-- 0144 — Anexos do atendimento: fotos de etiquetas de material (backlog 1/4).
--
-- Fotos das etiquetas de material utilizado, anexadas ao ATENDIMENTO. (O texto
-- de pós-atendimento usa as notas clínicas existentes.) Bucket privado
-- appointment-attachments, path {tenant}/{appointment}/{uuid}.{ext}.
--
-- Próximo número livre. Aditiva e idempotente.

CREATE TABLE IF NOT EXISTS public.appointment_attachments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  appointment_id  UUID NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  storage_path    TEXT NOT NULL,
  file_name       TEXT NOT NULL,
  content_type    TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL,
  kind            TEXT NOT NULL DEFAULT 'material_label'
                    CHECK (kind IN ('material_label', 'other')),
  uploaded_by     UUID NOT NULL REFERENCES auth.users(id),
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ NULL,
  deleted_by      UUID NULL REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS appointment_attachments_appt_idx
  ON public.appointment_attachments (tenant_id, appointment_id, uploaded_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE public.appointment_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS appointment_attachments_read ON public.appointment_attachments;
CREATE POLICY appointment_attachments_read ON public.appointment_attachments
  FOR SELECT USING (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS appointment_attachments_write ON public.appointment_attachments;
CREATE POLICY appointment_attachments_write ON public.appointment_attachments
  FOR ALL
  USING  (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN ('admin', 'recepcionista', 'profissional_saude'))
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN ('admin', 'recepcionista', 'profissional_saude'));

-- Bucket privado + policies (espelha patient-photos/0137).
INSERT INTO storage.buckets (id, name, public)
VALUES ('appointment-attachments', 'appointment-attachments', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS appt_attachments_tenant_read ON storage.objects;
CREATE POLICY appt_attachments_tenant_read
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'appointment-attachments'
    AND (storage.foldername(name))[1] = public.jwt_tenant_id()::text
  );

DROP POLICY IF EXISTS appt_attachments_staff_write ON storage.objects;
CREATE POLICY appt_attachments_staff_write
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'appointment-attachments'
    AND (storage.foldername(name))[1] = public.jwt_tenant_id()::text
    AND public.jwt_role() IN ('admin', 'recepcionista', 'profissional_saude')
  );

DROP POLICY IF EXISTS appt_attachments_staff_delete ON storage.objects;
CREATE POLICY appt_attachments_staff_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'appointment-attachments'
    AND (storage.foldername(name))[1] = public.jwt_tenant_id()::text
    AND public.jwt_role() IN ('admin', 'recepcionista', 'profissional_saude')
  );

COMMENT ON TABLE public.appointment_attachments IS
  'Backlog 1/4 — fotos de etiquetas de material anexadas ao atendimento.';

NOTIFY pgrst, 'reload schema';

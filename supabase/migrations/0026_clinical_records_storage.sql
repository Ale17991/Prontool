-- Bucket de armazenamento dos arquivos de prontuário (anexos).
-- Caminho dentro do bucket: `{tenant_id}/{patient_id}/{record_id}-{filename}`.
-- O primeiro segmento é o `tenant_id` puro pra que a RLS de storage.objects
-- consiga checar isolamento via storage.foldername(name)[1].

INSERT INTO storage.buckets (id, name, public)
VALUES ('clinical-files', 'clinical-files', false)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- RLS no bucket
--
-- Acesso direto ao bucket é restrito ao role `authenticated` cujo
-- `tenant_id` (custom claim) bate com o primeiro segmento do path. Writes
-- ainda exigem papel `admin` ou `financeiro`. O fluxo de upload via API
-- usa service-role e bypassa essas policies, mas elas existem como
-- defesa em profundidade caso o front passe a usar Supabase client direto
-- (URLs assinadas, presigned upload, etc).
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS clinical_files_tenant_read ON storage.objects;
CREATE POLICY clinical_files_tenant_read
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'clinical-files'
    AND (storage.foldername(name))[1] = public.jwt_tenant_id()::text
  );

DROP POLICY IF EXISTS clinical_files_tenant_insert ON storage.objects;
CREATE POLICY clinical_files_tenant_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'clinical-files'
    AND (storage.foldername(name))[1] = public.jwt_tenant_id()::text
    AND public.jwt_role() IN ('admin', 'financeiro')
  );

-- Updates (substituir arquivo) e deletes diretos por usuário ficam
-- bloqueados — anonymização e remoção são responsabilidade do server-side
-- (service-role) pra manter trilha de auditoria.
DROP POLICY IF EXISTS clinical_files_tenant_update ON storage.objects;
DROP POLICY IF EXISTS clinical_files_tenant_delete ON storage.objects;

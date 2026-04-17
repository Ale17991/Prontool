-- RPCs para listar / ler pacientes com PII descriptografada em uma única
-- ida ao banco. Aceitam a chave de criptografia como argumento (mesmo
-- mecanismo usado por `enc_text_with_key`/`dec_text_with_key`) pra evitar
-- depender da GUC `app.patient_encryption_key`, que não persiste entre
-- conexões pooladas do Supabase.
--
-- Usadas pelos handlers `GET /api/pacientes` (lista paginada com busca)
-- e `GET /api/pacientes/{id}` (detalhe).

CREATE OR REPLACE FUNCTION public.list_patients_for_tenant(
  p_tenant_id UUID,
  p_key       TEXT
) RETURNS TABLE (
  id              UUID,
  ghl_contact_id  TEXT,
  full_name       TEXT,
  cpf             TEXT,
  phone           TEXT,
  email           TEXT,
  birth_date      TEXT,
  anonymized_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
STABLE AS $$
  SELECT
    p.id,
    p.ghl_contact_id,
    extensions.pgp_sym_decrypt(p.full_name_enc, p_key),
    extensions.pgp_sym_decrypt(p.cpf_enc,       p_key),
    CASE WHEN p.phone_enc      IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(p.phone_enc,      p_key) END,
    CASE WHEN p.email_enc      IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(p.email_enc,      p_key) END,
    CASE WHEN p.birth_date_enc IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(p.birth_date_enc, p_key) END,
    p.anonymized_at,
    p.created_at,
    p.updated_at
  FROM public.patients p
  WHERE p.tenant_id = p_tenant_id
  ORDER BY p.created_at DESC
$$;

GRANT EXECUTE ON FUNCTION public.list_patients_for_tenant(UUID, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.get_patient_for_tenant(
  p_tenant_id  UUID,
  p_patient_id UUID,
  p_key        TEXT
) RETURNS TABLE (
  id              UUID,
  ghl_contact_id  TEXT,
  full_name       TEXT,
  cpf             TEXT,
  phone           TEXT,
  email           TEXT,
  birth_date      TEXT,
  anonymized_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
STABLE AS $$
  SELECT
    p.id,
    p.ghl_contact_id,
    CASE WHEN p.anonymized_at IS NOT NULL THEN '[anonimizado]'
         ELSE extensions.pgp_sym_decrypt(p.full_name_enc, p_key) END,
    CASE WHEN p.anonymized_at IS NOT NULL THEN '[anonimizado]'
         ELSE extensions.pgp_sym_decrypt(p.cpf_enc, p_key) END,
    CASE WHEN p.anonymized_at IS NOT NULL OR p.phone_enc IS NULL THEN NULL
         ELSE extensions.pgp_sym_decrypt(p.phone_enc, p_key) END,
    CASE WHEN p.anonymized_at IS NOT NULL OR p.email_enc IS NULL THEN NULL
         ELSE extensions.pgp_sym_decrypt(p.email_enc, p_key) END,
    CASE WHEN p.anonymized_at IS NOT NULL OR p.birth_date_enc IS NULL THEN NULL
         ELSE extensions.pgp_sym_decrypt(p.birth_date_enc, p_key) END,
    p.anonymized_at,
    p.created_at,
    p.updated_at
  FROM public.patients p
  WHERE p.tenant_id = p_tenant_id
    AND p.id = p_patient_id
$$;

GRANT EXECUTE ON FUNCTION public.get_patient_for_tenant(UUID, UUID, TEXT) TO service_role;

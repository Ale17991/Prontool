-- Idempotente: garante que TODAS as RPCs de leitura de paciente existem
-- com a assinatura e os grants corretos. Útil quando uma instalação de
-- prod ficou para trás em alguma das migrations 0027/0038/0043 — rodar
-- esta sozinha deixa o estado consistente.
--
-- Sintoma atrás dessa migration: /operacao/pacientes caía com erro
-- genérico em prod mesmo com banco vazio porque list_patients_for_tenant
-- não estava no schema cache do PostgREST.

-- ---- list_patients_for_tenant ----------------------------------------------
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
GRANT EXECUTE ON FUNCTION public.list_patients_for_tenant(UUID, TEXT) TO authenticated;

-- ---- get_patient_for_tenant ------------------------------------------------
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
GRANT EXECUTE ON FUNCTION public.get_patient_for_tenant(UUID, UUID, TEXT) TO authenticated;

-- ---- decrypt_patient_names_for_ids -----------------------------------------
CREATE OR REPLACE FUNCTION public.decrypt_patient_names_for_ids(
  p_tenant_id   UUID,
  p_patient_ids UUID[],
  p_key         TEXT
) RETURNS TABLE (
  id            UUID,
  full_name     TEXT,
  anonymized_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
STABLE AS $$
  SELECT
    p.id,
    CASE WHEN p.anonymized_at IS NOT NULL THEN '[anonimizado]'
         ELSE extensions.pgp_sym_decrypt(p.full_name_enc, p_key) END,
    p.anonymized_at
  FROM public.patients p
  WHERE p.tenant_id = p_tenant_id
    AND p.id = ANY(p_patient_ids)
$$;

GRANT EXECUTE ON FUNCTION public.decrypt_patient_names_for_ids(UUID, UUID[], TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.decrypt_patient_names_for_ids(UUID, UUID[], TEXT) TO authenticated;

-- Force PostgREST to refresh its function cache so the RPCs become
-- callable in the same deploy that ran this migration (without this
-- the cache only refreshes on next worker restart).
NOTIFY pgrst, 'reload schema';

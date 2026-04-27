-- 0046 — Endereço do paciente (cifrado em repouso, mesmo padrão da PII).
-- Todas as colunas são opcionais; pacientes legados podem não ter endereço.
--
-- O ALTER TABLE adiciona BYTEA columns; a leitura é via list_patients_for_tenant
-- e get_patient_for_tenant, que aqui são re-criadas com a nova assinatura
-- de retorno (mais 7 colunas decifradas). DROP + CREATE é necessário porque
-- mudar a coluna RETURNS TABLE de uma função SQL exige drop.

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS address_cep_enc          BYTEA,
  ADD COLUMN IF NOT EXISTS address_street_enc       BYTEA,
  ADD COLUMN IF NOT EXISTS address_number_enc       BYTEA,
  ADD COLUMN IF NOT EXISTS address_complement_enc   BYTEA,
  ADD COLUMN IF NOT EXISTS address_neighborhood_enc BYTEA,
  ADD COLUMN IF NOT EXISTS address_city_enc         BYTEA,
  ADD COLUMN IF NOT EXISTS address_state_enc        BYTEA;

-- ---- list_patients_for_tenant ----------------------------------------------
DROP FUNCTION IF EXISTS public.list_patients_for_tenant(UUID, TEXT);

CREATE FUNCTION public.list_patients_for_tenant(
  p_tenant_id UUID,
  p_key       TEXT
) RETURNS TABLE (
  id                    UUID,
  ghl_contact_id        TEXT,
  full_name             TEXT,
  cpf                   TEXT,
  phone                 TEXT,
  email                 TEXT,
  birth_date            TEXT,
  address_cep           TEXT,
  address_street        TEXT,
  address_number        TEXT,
  address_complement    TEXT,
  address_neighborhood  TEXT,
  address_city          TEXT,
  address_state         TEXT,
  anonymized_at         TIMESTAMPTZ,
  created_at            TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ
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
    CASE WHEN p.phone_enc                IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(p.phone_enc,                p_key) END,
    CASE WHEN p.email_enc                IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(p.email_enc,                p_key) END,
    CASE WHEN p.birth_date_enc           IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(p.birth_date_enc,           p_key) END,
    CASE WHEN p.address_cep_enc          IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(p.address_cep_enc,          p_key) END,
    CASE WHEN p.address_street_enc       IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(p.address_street_enc,       p_key) END,
    CASE WHEN p.address_number_enc       IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(p.address_number_enc,       p_key) END,
    CASE WHEN p.address_complement_enc   IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(p.address_complement_enc,   p_key) END,
    CASE WHEN p.address_neighborhood_enc IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(p.address_neighborhood_enc, p_key) END,
    CASE WHEN p.address_city_enc         IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(p.address_city_enc,         p_key) END,
    CASE WHEN p.address_state_enc        IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(p.address_state_enc,        p_key) END,
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
DROP FUNCTION IF EXISTS public.get_patient_for_tenant(UUID, UUID, TEXT);

CREATE FUNCTION public.get_patient_for_tenant(
  p_tenant_id  UUID,
  p_patient_id UUID,
  p_key        TEXT
) RETURNS TABLE (
  id                    UUID,
  ghl_contact_id        TEXT,
  full_name             TEXT,
  cpf                   TEXT,
  phone                 TEXT,
  email                 TEXT,
  birth_date            TEXT,
  address_cep           TEXT,
  address_street        TEXT,
  address_number        TEXT,
  address_complement    TEXT,
  address_neighborhood  TEXT,
  address_city          TEXT,
  address_state         TEXT,
  anonymized_at         TIMESTAMPTZ,
  created_at            TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ
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
    CASE WHEN p.anonymized_at IS NOT NULL OR p.phone_enc                IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(p.phone_enc,                p_key) END,
    CASE WHEN p.anonymized_at IS NOT NULL OR p.email_enc                IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(p.email_enc,                p_key) END,
    CASE WHEN p.anonymized_at IS NOT NULL OR p.birth_date_enc           IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(p.birth_date_enc,           p_key) END,
    CASE WHEN p.anonymized_at IS NOT NULL OR p.address_cep_enc          IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(p.address_cep_enc,          p_key) END,
    CASE WHEN p.anonymized_at IS NOT NULL OR p.address_street_enc       IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(p.address_street_enc,       p_key) END,
    CASE WHEN p.anonymized_at IS NOT NULL OR p.address_number_enc       IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(p.address_number_enc,       p_key) END,
    CASE WHEN p.anonymized_at IS NOT NULL OR p.address_complement_enc   IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(p.address_complement_enc,   p_key) END,
    CASE WHEN p.anonymized_at IS NOT NULL OR p.address_neighborhood_enc IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(p.address_neighborhood_enc, p_key) END,
    CASE WHEN p.anonymized_at IS NOT NULL OR p.address_city_enc         IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(p.address_city_enc,         p_key) END,
    CASE WHEN p.anonymized_at IS NOT NULL OR p.address_state_enc        IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(p.address_state_enc,        p_key) END,
    p.anonymized_at,
    p.created_at,
    p.updated_at
  FROM public.patients p
  WHERE p.tenant_id = p_tenant_id
    AND p.id = p_patient_id
$$;

GRANT EXECUTE ON FUNCTION public.get_patient_for_tenant(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_patient_for_tenant(UUID, UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

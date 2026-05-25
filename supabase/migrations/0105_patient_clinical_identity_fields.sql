-- 0105 — Campos de identificação clínica do paciente, alinhando o cadastro
-- ao padrão de mercado (HiDoctor/Feegow/e-SUS) e às exigências legais.
--
-- Acréscimos (todos opcionais, aditivos e reversíveis):
--   • sex                          — sexo biológico (TEXT em claro; não é PII
--                                    identificadora isolada e é usado em
--                                    referências clínicas — fica fora da cifra
--                                    para permitir filtro/relatório).
--   • social_name_enc             — nome social (Decreto 8.727/2016).
--   • mother_name_enc             — nome da mãe (identificação inequívoca / TISS).
--   • rg_enc                      — documento de identidade (RG).
--   • insurance_card_number_enc   — número da carteirinha do convênio (matrícula),
--                                    indispensável para faturamento de convênio.
--   • emergency_contact_name_enc  — contato de emergência (nome).
--   • emergency_contact_phone_enc — contato de emergência (telefone).
--   • guardian_name_enc           — responsável legal (nome) — menores/incapazes.
--   • guardian_cpf_enc            — responsável legal (CPF).
--   • guardian_relationship_enc   — responsável legal (parentesco).
--
-- Toda PII segue o mesmo padrão de cifra em repouso (BYTEA via pgp_sym_*),
-- decifrada apenas pelas RPCs SECURITY DEFINER. `get_patient_for_tenant` é
-- recriada com as novas colunas decifradas e respeitando `anonymized_at`.
-- `list_patients_for_tenant` permanece enxuta de propósito (esses campos não
-- aparecem na listagem — só no detalhe).

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS sex                          TEXT,
  ADD COLUMN IF NOT EXISTS social_name_enc              BYTEA,
  ADD COLUMN IF NOT EXISTS mother_name_enc              BYTEA,
  ADD COLUMN IF NOT EXISTS rg_enc                       BYTEA,
  ADD COLUMN IF NOT EXISTS insurance_card_number_enc    BYTEA,
  ADD COLUMN IF NOT EXISTS emergency_contact_name_enc   BYTEA,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone_enc  BYTEA,
  ADD COLUMN IF NOT EXISTS guardian_name_enc            BYTEA,
  ADD COLUMN IF NOT EXISTS guardian_cpf_enc             BYTEA,
  ADD COLUMN IF NOT EXISTS guardian_relationship_enc    BYTEA;

-- Sexo biológico: domínio fechado. NULL = não informado.
ALTER TABLE public.patients
  DROP CONSTRAINT IF EXISTS patients_sex_check;
ALTER TABLE public.patients
  ADD CONSTRAINT patients_sex_check
  CHECK (sex IS NULL OR sex IN ('feminino', 'masculino', 'intersexo'));

COMMENT ON COLUMN public.patients.sex IS
  'Sexo biológico (feminino|masculino|intersexo). NULL = não informado. Em claro (não é PII identificadora isolada; usado em referências clínicas).';
COMMENT ON COLUMN public.patients.social_name_enc IS
  'Nome social cifrado (Decreto 8.727/2016). NULL quando não informado.';
COMMENT ON COLUMN public.patients.insurance_card_number_enc IS
  'Número da carteirinha/matrícula do convênio, cifrado. Necessário para faturamento de convênio.';

-- ---- get_patient_for_tenant ------------------------------------------------
-- Recriada com as novas colunas. DROP + CREATE é necessário porque a lista de
-- colunas de RETURNS TABLE muda.
DROP FUNCTION IF EXISTS public.get_patient_for_tenant(UUID, UUID, TEXT);

CREATE FUNCTION public.get_patient_for_tenant(
  p_tenant_id  UUID,
  p_patient_id UUID,
  p_key        TEXT
) RETURNS TABLE (
  id                       UUID,
  ghl_contact_id           TEXT,
  full_name                TEXT,
  social_name              TEXT,
  sex                      TEXT,
  cpf                      TEXT,
  rg                       TEXT,
  mother_name              TEXT,
  phone                    TEXT,
  email                    TEXT,
  birth_date               TEXT,
  insurance_card_number    TEXT,
  emergency_contact_name   TEXT,
  emergency_contact_phone  TEXT,
  guardian_name            TEXT,
  guardian_cpf             TEXT,
  guardian_relationship    TEXT,
  address_cep              TEXT,
  address_street           TEXT,
  address_number           TEXT,
  address_complement       TEXT,
  address_neighborhood     TEXT,
  address_city             TEXT,
  address_state            TEXT,
  anonymized_at            TIMESTAMPTZ,
  created_at               TIMESTAMPTZ,
  updated_at               TIMESTAMPTZ
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
    CASE WHEN p.anonymized_at IS NOT NULL OR p.social_name_enc            IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(p.social_name_enc,            p_key) END,
    p.sex,
    CASE WHEN p.anonymized_at IS NOT NULL THEN '[anonimizado]'
         ELSE extensions.pgp_sym_decrypt(p.cpf_enc, p_key) END,
    CASE WHEN p.anonymized_at IS NOT NULL OR p.rg_enc                     IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(p.rg_enc,                     p_key) END,
    CASE WHEN p.anonymized_at IS NOT NULL OR p.mother_name_enc            IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(p.mother_name_enc,            p_key) END,
    CASE WHEN p.anonymized_at IS NOT NULL OR p.phone_enc                  IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(p.phone_enc,                  p_key) END,
    CASE WHEN p.anonymized_at IS NOT NULL OR p.email_enc                  IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(p.email_enc,                  p_key) END,
    CASE WHEN p.anonymized_at IS NOT NULL OR p.birth_date_enc             IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(p.birth_date_enc,             p_key) END,
    CASE WHEN p.anonymized_at IS NOT NULL OR p.insurance_card_number_enc  IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(p.insurance_card_number_enc,  p_key) END,
    CASE WHEN p.anonymized_at IS NOT NULL OR p.emergency_contact_name_enc IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(p.emergency_contact_name_enc, p_key) END,
    CASE WHEN p.anonymized_at IS NOT NULL OR p.emergency_contact_phone_enc IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(p.emergency_contact_phone_enc, p_key) END,
    CASE WHEN p.anonymized_at IS NOT NULL OR p.guardian_name_enc          IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(p.guardian_name_enc,          p_key) END,
    CASE WHEN p.anonymized_at IS NOT NULL OR p.guardian_cpf_enc           IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(p.guardian_cpf_enc,           p_key) END,
    CASE WHEN p.anonymized_at IS NOT NULL OR p.guardian_relationship_enc  IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(p.guardian_relationship_enc,  p_key) END,
    CASE WHEN p.anonymized_at IS NOT NULL OR p.address_cep_enc            IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(p.address_cep_enc,            p_key) END,
    CASE WHEN p.anonymized_at IS NOT NULL OR p.address_street_enc         IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(p.address_street_enc,         p_key) END,
    CASE WHEN p.anonymized_at IS NOT NULL OR p.address_number_enc         IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(p.address_number_enc,         p_key) END,
    CASE WHEN p.anonymized_at IS NOT NULL OR p.address_complement_enc     IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(p.address_complement_enc,     p_key) END,
    CASE WHEN p.anonymized_at IS NOT NULL OR p.address_neighborhood_enc   IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(p.address_neighborhood_enc,   p_key) END,
    CASE WHEN p.anonymized_at IS NOT NULL OR p.address_city_enc           IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(p.address_city_enc,           p_key) END,
    CASE WHEN p.anonymized_at IS NOT NULL OR p.address_state_enc          IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(p.address_state_enc,          p_key) END,
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

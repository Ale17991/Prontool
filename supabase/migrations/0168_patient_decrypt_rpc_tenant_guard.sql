-- 0168 — Defesa em profundidade nas RPCs de decrypt de PII (revisão 2026-07).
--
-- PROBLEMA: list_patients_for_tenant / get_patient_for_tenant /
-- decrypt_patient_names_for_ids são SECURITY DEFINER, concedidas a
-- `authenticated`, e só filtram `WHERE tenant_id = p_tenant_id` — SEM checar
-- que o caller pertence a p_tenant_id. A única barreira contra um usuário
-- logado dumpar PII de outra clínica era o segredo `p_key` (a chave de
-- criptografia). Não explorável hoje (a chave só vive no servidor), mas é
-- camada ÚNICA de defesa.
--
-- CORREÇÃO:
--   • get_patient_for_tenant e decrypt_patient_names_for_ids são chamadas
--     SEMPRE via service client (server-side) — revogamos EXECUTE de
--     `authenticated`, fechando o acesso via PostgREST sem tocar no corpo.
--   • list_patients_for_tenant é chamada com o client AUTENTICADO (a página
--     de pacientes) — acrescentamos guarda de tenant no WHERE: retorna vazio
--     se o caller não for service_role e o jwt_tenant não bater com p_tenant_id.

-- --- Revogações (service-only) ---------------------------------------------
REVOKE EXECUTE ON FUNCTION public.get_patient_for_tenant(UUID, UUID, TEXT) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.decrypt_patient_names_for_ids(UUID, UUID[], TEXT) FROM authenticated;

-- --- list_patients_for_tenant — corpo byte-exato da 0046 + guarda no WHERE ---
CREATE OR REPLACE FUNCTION public.list_patients_for_tenant(
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
    -- Guarda de tenant (defesa em profundidade): authenticated só vê a própria
    -- clínica; service_role passa. Cross-tenant/claim NULL ⇒ retorna vazio.
    AND (public.jwt_role() = 'service_role' OR public.jwt_tenant_id() = p_tenant_id)
  ORDER BY p.created_at DESC
$$;

NOTIFY pgrst, 'reload schema';

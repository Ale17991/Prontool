-- ---------------------------------------------------------------------------
-- Carga em lote de pacientes — one-off, conta "Thiago Padilha".
--
-- POR QUE UMA FUNÇÃO NO BANCO, E NÃO O CAMINHO NORMAL:
-- `createPatientManually` cifra cada campo com uma chamada de RPC
-- (`enc_text_with_key`) por campo. São ~15 campos; em 14,5 mil pacientes isso
-- daria ~217 mil idas e voltas ao PostgREST. Aqui a cifragem acontece DENTRO
-- do INSERT, então o lote inteiro custa uma chamada por bloco.
--
-- A chave (PATIENT_DATA_ENCRYPTION_KEY) continua vindo de fora, do script, do
-- mesmo jeito que `enc_text_with_key` já faz — nada de segredo escrito aqui.
--
-- Isto NÃO é migration: não é schema de produto, é ferramenta de mudança. A
-- última linha do arquivo remove a função. Rode a carga, depois rode o DROP.
--
-- PRÉ-REQUISITO: a migration `0208_patient_demographics.sql` precisa estar
-- aplicada — esta função grava `marital_status`, `race` e `occupation`.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.import_patients_bulk(
  p_tenant_id UUID,
  p_key TEXT,
  p_rows JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  n INTEGER := 0;
BEGIN
  -- pgp_sym_encrypt é STRICT: entrada NULL devolve NULL. Por isso `r->>'x'`
  -- de uma chave ausente vira coluna NULL sem precisar de CASE — e campo
  -- ausente continua ausente, nunca vira string vazia cifrada.
  INSERT INTO public.patients (
    tenant_id,
    full_name_enc,
    phone_enc,
    birth_date_enc,
    email_enc,
    sex,
    marital_status,
    race,
    occupation,
    plan_id,
    alert_note,
    insurance_card_number_enc,
    address_cep_enc,
    address_street_enc,
    address_number_enc,
    address_complement_enc,
    address_neighborhood_enc,
    address_city_enc,
    address_state_enc
  )
  SELECT
    p_tenant_id,
    extensions.pgp_sym_encrypt(r->>'full_name', p_key),
    extensions.pgp_sym_encrypt(r->>'phone', p_key),
    extensions.pgp_sym_encrypt(r->>'birth_date', p_key),
    extensions.pgp_sym_encrypt(r->>'email', p_key),
    r->>'sex',
    -- Colunas em claro da 0208. Vão sem cifrar de propósito: são as mesmas
    -- que o CHECK da migration valida, e o CHECK não enxerga bytea.
    r->>'marital_status',
    r->>'race',
    r->>'occupation',
    (r->>'plan_id')::UUID,
    r->>'alert_note',
    extensions.pgp_sym_encrypt(r->>'insurance_card_number', p_key),
    extensions.pgp_sym_encrypt(r->>'address_cep', p_key),
    extensions.pgp_sym_encrypt(r->>'address_street', p_key),
    extensions.pgp_sym_encrypt(r->>'address_number', p_key),
    extensions.pgp_sym_encrypt(r->>'address_complement', p_key),
    extensions.pgp_sym_encrypt(r->>'address_neighborhood', p_key),
    extensions.pgp_sym_encrypt(r->>'address_city', p_key),
    extensions.pgp_sym_encrypt(r->>'address_state', p_key)
  FROM jsonb_array_elements(p_rows) AS r;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;

-- A função é chamada pelo script com a service key; ninguém mais precisa dela.
REVOKE ALL ON FUNCTION public.import_patients_bulk(UUID, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.import_patients_bulk(UUID, TEXT, JSONB) FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- DEPOIS DA CARGA, rode isto:
--
--   DROP FUNCTION IF EXISTS public.import_patients_bulk(UUID, TEXT, JSONB);
--
-- Deixá-la de pé seria manter no banco um jeito de inserir paciente sem passar
-- por RBAC, evento de domínio nem validação de campo obrigatório.
-- ---------------------------------------------------------------------------

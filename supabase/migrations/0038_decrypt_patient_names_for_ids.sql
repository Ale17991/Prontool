-- 0038 — RPC estreita para decriptar nomes de pacientes por id.
--
-- A RPC existente list_patients_for_tenant (migration 0027) decripta
-- TUDO do tenant — 6 campos de PII × N pacientes — e foi desenhada pros
-- endpoints /api/pacientes. Usar ela pra "só mostrar o nome do paciente
-- ao lado do atendimento" (ex: /operacao/atendimentos) é caro pra
-- tenants grandes: faz decripta de dados que o caller nem vai renderizar,
-- e faz pra pacientes que podem estar fora da página.
--
-- Esta RPC aceita um array de patient_ids, devolve só id/full_name/
-- anonymized_at e filtra pelo tenant. Uso esperado: caller tem N linhas
-- de appointments_effective (ou outra tabela que aponta pra patients) e
-- precisa resolver o mapa {patient_id → nome} pra exibição.

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

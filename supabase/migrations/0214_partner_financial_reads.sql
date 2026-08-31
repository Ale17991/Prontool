-- =========================================================================
-- 0214 — Leitura financeira da clínica pela API de parceiro
--
-- O parceiro (zee.lu) emite a nota fiscal DA CLÍNICA a partir do que já está
-- no Clinni: movimentações, serviços prestados e cobranças. Para que a nota
-- tenha tomador, precisa do nome e do CPF do paciente — que vivem CIFRADOS
-- (`full_name_enc`, `cpf_enc`).
--
-- `get_patient_for_tenant` (0027) decifra UM paciente e devolve a ficha
-- inteira. Chamá-la em laço numa listagem de 500 cobranças seriam 500 idas ao
-- banco para usar dois campos de cada — e traria junto endereço, nascimento e
-- todo o resto, que o parceiro não deve receber.
--
-- Esta RPC decifra EM LOTE e devolve SÓ nome e CPF. A restrição não é
-- desempenho: é o princípio de que o parceiro recebe o mínimo necessário para
-- emitir a nota, e a forma da função é o que torna o excesso impossível em vez
-- de improvável.
--
-- NADA de clínico atravessa: sem diagnóstico, sem anamnese, sem prontuário.
-- O que o parceiro vê do atendimento é o procedimento (descrição do serviço,
-- obrigatória na nota) e o valor.
--
-- Constituição: III multi-tenant (p_tenant_id é filtro obrigatório e o parceiro
-- nunca o escolhe — vem do vínculo conferido no guard); V RBAC (EXECUTE só para
-- service_role).
-- Reversibilidade: aditiva e idempotente.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.patient_identities_for_billing(
  p_tenant_id   UUID,
  p_patient_ids UUID[],
  p_key         TEXT
) RETURNS TABLE (
  id        UUID,
  full_name TEXT,
  cpf       TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    p.id,
    extensions.pgp_sym_decrypt(p.full_name_enc, p_key),
    CASE
      WHEN p.cpf_enc IS NULL THEN NULL
      ELSE extensions.pgp_sym_decrypt(p.cpf_enc, p_key)
    END
  FROM public.patients p
  WHERE p.tenant_id = p_tenant_id
    AND p.id = ANY(p_patient_ids)
    -- Paciente anonimizado (direito ao esquecimento) não volta identificado.
    -- A cobrança dele continua existindo no financeiro; o que sai daqui é o
    -- vazio, e quem consome mostra o traço. Reidentificar por uma via lateral
    -- desfaria o apagamento que a clínica executou.
    AND p.anonymized_at IS NULL;
$$;

COMMENT ON FUNCTION public.patient_identities_for_billing(UUID, UUID[], TEXT) IS
  '0214 — nome e CPF de varios pacientes de um tenant, para o tomador da nota fiscal. Devolve SO estes dois campos por desenho. Ignora paciente anonimizado.';

REVOKE ALL ON FUNCTION public.patient_identities_for_billing(UUID, UUID[], TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.patient_identities_for_billing(UUID, UUID[], TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.patient_identities_for_billing(UUID, UUID[], TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- `list_patients_for_tenant` passa a paginar e buscar NO BANCO.
--
-- O QUE QUEBROU: a função decifrava as 14 colunas de PII de TODOS os pacientes
-- da clínica e devolvia tudo; busca e paginação eram feitas em JavaScript. A
-- 1.000 pacientes isso custava ~1,4 s e passava. Ao importar a base do
-- HiDoctor, a maior clínica foi a 15.381 pacientes — 215 mil decifragens numa
-- consulta só, ~21 s, contra um `statement_timeout` de 8 s. A tela de
-- pacientes parou com "canceling statement due to statement timeout".
--
-- Não foi surpresa: o comentário de `list.ts` já dizia "para tenants com >10k
-- pacientes vai ficar lento". A importação apenas chegou lá.
--
-- O CONSERTO, em duas frentes:
--
--   • SEM BUSCA (o caso comum — abrir a tela) a paginação vai para o SQL:
--     ordena por índice, corta 25 ids e decifra SÓ esses 25. Passa a custar o
--     mesmo em qualquer tamanho de base. É a diferença entre 21 s e ~35 ms.
--
--   • COM BUSCA ainda é preciso varrer, porque nome/CPF/telefone estão
--     cifrados e não há índice possível sobre bytea. Mas decifra apenas a
--     coluna que o termo exige (ver `v_tem_letra`) em vez das 14, e decifra o
--     registro inteiro só da página devolvida. ~1,5 s procurando por nome,
--     ~3 s por número.
--
-- O QUE ISTO NÃO RESOLVE: a busca continua linear no tamanho da base. A
-- solução definitiva é índice cego por trigramas (HMAC dos 3-gramas do nome
-- numa tabela lateral com GIN), que permitiria busca indexada sem guardar
-- nome em claro. É feature própria, com backfill — não cabe num conserto de
-- produção parada.
-- ---------------------------------------------------------------------------

-- A ordenação da listagem é (tenant, mais recente primeiro). Sem este índice o
-- caminho sem busca ainda varreria a clínica inteira só para achar os 25 do
-- topo, e o conserto não teria conserto nenhum.
CREATE INDEX IF NOT EXISTS patients_tenant_created_at_idx
  ON public.patients (tenant_id, created_at DESC, id DESC);

-- A assinatura muda (ganha busca/limite/deslocamento e devolve o total), e
-- CREATE OR REPLACE não altera tipo de retorno — tem que derrubar antes.
DROP FUNCTION IF EXISTS public.list_patients_for_tenant(UUID, TEXT);

CREATE FUNCTION public.list_patients_for_tenant(
  p_tenant_id UUID,
  p_key       TEXT,
  p_search    TEXT DEFAULT NULL,
  p_limit     INT  DEFAULT 25,
  p_offset    INT  DEFAULT 0
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
  updated_at            TIMESTAMPTZ,
  -- Repetido em toda linha. É desperdício de 25 inteiros e evita uma segunda
  -- varredura só para contar — que no caminho com busca custaria o dobro.
  total_count           BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
STABLE AS $$
DECLARE
  v_termo     TEXT    := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_digitos   TEXT;
  v_tem_letra BOOLEAN;
  v_limit     INT     := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  v_offset    INT     := GREATEST(COALESCE(p_offset, 0), 0);
  v_todos     UUID[];
  v_pagina    UUID[];
  v_total     BIGINT;
BEGIN
  -- Guarda de tenant da 0168, agora no topo: sem ela, `authenticated` de outra
  -- clínica leria PII daqui. Sair vazio é o mesmo desfecho de antes.
  IF NOT (public.jwt_role() = 'service_role' OR public.jwt_tenant_id() = p_tenant_id) THEN
    RETURN;
  END IF;

  IF v_termo IS NULL THEN
    -- ---- Caminho rápido: sem busca, o índice resolve tudo. ----
    SELECT count(*) INTO v_total
      FROM public.patients p
     WHERE p.tenant_id = p_tenant_id;

    SELECT array_agg(z.id ORDER BY z.created_at DESC, z.id DESC)
      INTO v_pagina
      FROM (
        SELECT p.id, p.created_at
          FROM public.patients p
         WHERE p.tenant_id = p_tenant_id
         ORDER BY p.created_at DESC, p.id DESC
         LIMIT v_limit OFFSET v_offset
      ) z;
  ELSE
    -- ---- Caminho com busca: varre, mas decifra o mínimo. ----
    v_digitos   := regexp_replace(v_termo, '\D', '', 'g');
    -- "Tem letra" = tem algo que não é dígito nem pontuação de telefone. Um
    -- termo só de números não procura em nome: nome com dígito é resíduo de
    -- digitação, e pular essa coluna faz a busca por CPF/telefone custar um
    -- terço. Termo com letra não procura em CPF/telefone pelo mesmo motivo.
    v_tem_letra := v_termo ~ '[^0-9[:space:].()/+-]';

    -- `position(... IN ...)` e não LIKE: é a tradução exata do `includes()`
    -- que o TypeScript fazia, e não dá significado especial a `%` ou `_` —
    -- com LIKE, digitar "%" na busca casaria com a clínica inteira.
    SELECT array_agg(c.id ORDER BY c.created_at DESC, c.id DESC)
      INTO v_todos
      FROM (
        SELECT p.id, p.created_at
          FROM public.patients p
         WHERE p.tenant_id = p_tenant_id
           AND (
             (
               v_tem_letra
               AND position(
                     lower(v_termo) IN lower(extensions.pgp_sym_decrypt(p.full_name_enc, p_key))
                   ) > 0
             )
             OR (
               v_digitos <> ''
               AND p.cpf_enc IS NOT NULL
               AND position(
                     v_digitos IN regexp_replace(
                       extensions.pgp_sym_decrypt(p.cpf_enc, p_key), '\D', '', 'g')
                   ) > 0
             )
             OR (
               v_digitos <> ''
               AND p.phone_enc IS NOT NULL
               AND position(
                     v_digitos IN regexp_replace(
                       extensions.pgp_sym_decrypt(p.phone_enc, p_key), '\D', '', 'g')
                   ) > 0
             )
           )
      ) c;

    v_total  := COALESCE(array_length(v_todos, 1), 0);
    -- Fatia do array em vez de repetir a varredura para contar e para paginar.
    v_pagina := v_todos[(v_offset + 1):(v_offset + v_limit)];
  END IF;

  IF v_pagina IS NULL OR array_length(v_pagina, 1) IS NULL THEN
    RETURN;
  END IF;

  -- Só aqui a PII é decifrada, e só das linhas que vão para a tela.
  RETURN QUERY
  SELECT
    p.id,
    p.ghl_contact_id,
    extensions.pgp_sym_decrypt(p.full_name_enc, p_key),
    CASE WHEN p.cpf_enc                  IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(p.cpf_enc,                  p_key) END,
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
    p.updated_at,
    v_total
  FROM public.patients p
  WHERE p.id = ANY(v_pagina)
  ORDER BY p.created_at DESC, p.id DESC;
END
$$;

-- Os mesmos grants de antes (0027/0043/0044/0046). O DROP levou os antigos
-- junto: sem reconceder, a tela de pacientes tomaria "permission denied", que
-- é trocar um jeito de quebrar por outro.
GRANT EXECUTE ON FUNCTION public.list_patients_for_tenant(UUID, TEXT, TEXT, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_patients_for_tenant(UUID, TEXT, TEXT, INT, INT) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- 0217 — Revelar credencial de parceiro vira UM comando
--
-- BUG: todo revelar quebrava com `23514` (violação de CHECK), e o parceiro via
-- "Application error: a server-side exception has occurred".
--
-- O CHECK `partner_credential_links_burned` da 0215 diz "revelado ⇒ sem
-- segredo". O código fazia em dois passos: marcava `revealed_at` para RESERVAR
-- o link (garantindo o uso único), lia o segredo, decifrava, e só então apagava
-- `secret_enc`. O primeiro passo cria justamente o estado que a constraint
-- proíbe — revelado COM segredo — e era rejeitado.
--
-- Os dois lados estavam certos isoladamente e incompatíveis juntos. Nem `tsc`
-- nem `next build` pegam isso: é uma regra que só existe no banco, e só
-- executando contra o schema real ela aparece.
--
-- A saída não é afrouxar a constraint — ela é a garantia de que não fica
-- segredo recuperável parado numa linha já usada. É fazer as duas escritas em
-- UM comando, sem estado intermediário:
--
--   D1  `SELECT ... FOR UPDATE` reserva a linha e devolve o segredo ANTIGO.
--       `UPDATE ... RETURNING` não serviria: RETURNING dá o valor NOVO, que é
--       exatamente o NULL que acabamos de gravar.
--
--   D2  O uso único passa a ser o LOCK, não um `WHERE revealed_at IS NULL` num
--       UPDATE solto. Duas chamadas simultâneas disputam a mesma linha: a
--       segunda espera o lock, reavalia a qualificação depois dele e não
--       encontra mais linha elegível. Devolve NULL, e a tela diz "já usado".
--
--   D3  SECURITY DEFINER com EXECUTE só para service_role. A chave de cifra
--       viaja como argumento (mesmo padrão de `get_patient_for_tenant`), nunca
--       fica no banco.
--
-- Constituição: V RBAC (service_role-only). Reversibilidade: aditiva.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.reveal_partner_credential(
  p_token_hash TEXT,
  p_key        TEXT,
  p_ip         TEXT
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_id     UUID;
  v_cipher BYTEA;
BEGIN
  -- D1/D2: reserva a linha e leva o segredo antigo junto.
  SELECT id, secret_enc
    INTO v_id, v_cipher
    FROM public.partner_credential_links
   WHERE token_hash  = p_token_hash
     AND revealed_at IS NULL
     AND expires_at  > now()
   FOR UPDATE;

  -- Inexistente, já revelado ou expirado. Quem chama distingue os três
  -- consultando o estado depois — aqui não há o que revelar em nenhum caso.
  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.partner_credential_links
     SET revealed_at = now(),
         revealed_ip = p_ip,
         secret_enc  = NULL
   WHERE id = v_id;

  RETURN extensions.pgp_sym_decrypt(v_cipher, p_key);
END;
$$;

COMMENT ON FUNCTION public.reveal_partner_credential(TEXT, TEXT, TEXT) IS
  '0217 — revela a credencial de parceiro e queima o link em UM comando. O uso unico e o FOR UPDATE; o CHECK burned da 0215 continua valendo porque nao ha estado intermediario.';

REVOKE ALL ON FUNCTION public.reveal_partner_credential(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reveal_partner_credential(TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reveal_partner_credential(TEXT, TEXT, TEXT) TO service_role;

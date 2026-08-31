-- =========================================================================
-- 0215 — Entrega da credencial e blindagem da API de parceiro
--
-- Um parceiro é um sistema de fora, operado por gente que não trabalha aqui.
-- A 0213 deu a ele autenticação e recorte; esta migration trata do que sobra:
-- como a credencial CHEGA até ele sem passar por WhatsApp, e o que acontece se
-- ele — ou quem roubar a chave dele — resolver varrer a base.
--
--   D1  A credencial é entregue por LINK DE USO ÚNICO, e o segredo fica
--       cifrado na linha até ser revelado. Mandar a chave por mensagem a
--       deixa para sempre no histórico de dois aparelhos; o link expira,
--       queima ao ser usado e registra quando foi.
--
--   D2  Revelar é POST, nunca GET. Cliente de e-mail e antivírus corporativo
--       PRÉ-CARREGAM links; um GET que consome faria a credencial ser
--       queimada por um robô antes de o parceiro abrir a mensagem, e o
--       sintoma ("o link já foi usado") não apontaria para a causa.
--
--   D3  Limite de requisições POR CHAVE, no banco. A alternativa em memória
--       não sobrevive a serverless: cada instância teria o próprio contador e
--       o teto real seria o teto vezes o número de instâncias.
--
--   D4  Faixa de IP por chave, opcional. Chave vazada é o cenário mais
--       provável de incidente, e a faixa transforma "quem tiver a chave" em
--       "quem tiver a chave E estiver na rede do parceiro".
--
--   D5  Validade por chave. Credencial eterna é credencial que ninguém
--       lembra de girar.
--
-- Constituição: III (recorte por parceiro é o análogo do recorte por tenant);
-- V RBAC (tabelas de plataforma, service_role-only).
-- Reversibilidade: aditiva e idempotente.
-- =========================================================================

-- =========================================================================
-- 1. partner_api_keys — faixa de IP e validade (D4, D5)
-- =========================================================================

ALTER TABLE public.partner_api_keys
  ADD COLUMN IF NOT EXISTS allowed_ips TEXT[] NULL,
  ADD COLUMN IF NOT EXISTS expires_at   TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.partner_api_keys.allowed_ips IS
  'Faixas CIDR ou IPs exatos permitidos. NULL = sem restricao de origem. Array VAZIO nao libera tudo: bloqueia tudo.';
COMMENT ON COLUMN public.partner_api_keys.expires_at IS
  'Validade da chave. NULL = sem prazo. Vencida autentica como invalida, sem distincao.';

-- =========================================================================
-- 2. partner_credential_links — entrega de uso único (D1, D2)
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.partner_credential_links (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id    UUID        NOT NULL REFERENCES public.partner_api_keys(id) ON DELETE CASCADE,
  -- SHA-256 hex do token do link. O token em claro só existe na URL entregue;
  -- vazar o banco não permite abrir o link.
  token_hash    TEXT        NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  -- A chave cifrada, esperando ser revelada UMA vez. É apagada (NULL) no
  -- momento da revelação — não fica um segredo recuperável parado no banco.
  secret_enc    BYTEA       NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  revealed_at   TIMESTAMPTZ NULL,
  revealed_ip   TEXT        NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID        NULL REFERENCES auth.users(id),
  CONSTRAINT partner_credential_links_burned CHECK (
    -- Revelado ⇒ o segredo não está mais aqui. O banco garante o que o código
    -- promete: não existe linha revelada que ainda carregue a credencial.
    revealed_at IS NULL OR secret_enc IS NULL
  )
);

COMMENT ON TABLE public.partner_credential_links IS
  '0215 — entrega de credencial de parceiro por link de uso unico. secret_enc e apagado na revelacao; revelar e POST (D2).';

CREATE INDEX IF NOT EXISTS partner_credential_links_key_idx
  ON public.partner_credential_links (api_key_id, created_at DESC);

ALTER TABLE public.partner_credential_links ENABLE ROW LEVEL SECURITY;
-- Sem policy para `authenticated`: a linha carrega credencial cifrada.

-- =========================================================================
-- 3. partner_api_rate_limits — teto por chave, no banco (D3)
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.partner_api_rate_limits (
  api_key_id   UUID        NOT NULL REFERENCES public.partner_api_keys(id) ON DELETE CASCADE,
  -- Início da janela, truncado no minuto pelo chamador.
  window_start TIMESTAMPTZ NOT NULL,
  hits         INTEGER     NOT NULL DEFAULT 0,
  PRIMARY KEY (api_key_id, window_start)
);

COMMENT ON TABLE public.partner_api_rate_limits IS
  '0215 — contador de requisicoes por chave e por janela. No banco porque contador em memoria nao sobrevive a serverless (D3).';

CREATE INDEX IF NOT EXISTS partner_api_rate_limits_window_idx
  ON public.partner_api_rate_limits (window_start);

ALTER TABLE public.partner_api_rate_limits ENABLE ROW LEVEL SECURITY;

/**
 * Registra uma requisição e devolve quantas já houve na janela.
 *
 * O incremento e a leitura acontecem no MESMO comando: dois processos
 * concorrentes não conseguem ler o mesmo valor e ambos concluir que há vaga —
 * que é exatamente o furo de um `SELECT` seguido de `UPDATE`.
 */
CREATE OR REPLACE FUNCTION public.partner_api_rate_hit(
  p_api_key_id   UUID,
  p_window_start TIMESTAMPTZ
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hits INTEGER;
BEGIN
  INSERT INTO public.partner_api_rate_limits (api_key_id, window_start, hits)
  VALUES (p_api_key_id, p_window_start, 1)
  ON CONFLICT (api_key_id, window_start)
  DO UPDATE SET hits = public.partner_api_rate_limits.hits + 1
  RETURNING hits INTO v_hits;

  -- Faxina barata e oportunista: janelas velhas não interessam a ninguém e
  -- uma tabela de contador que só cresce vira problema silencioso. Roda em 1%
  -- das chamadas para não pagar o DELETE em toda requisição.
  IF random() < 0.01 THEN
    DELETE FROM public.partner_api_rate_limits
    WHERE window_start < now() - INTERVAL '2 hours';
  END IF;

  RETURN v_hits;
END;
$$;

REVOKE ALL ON FUNCTION public.partner_api_rate_hit(UUID, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.partner_api_rate_hit(UUID, TIMESTAMPTZ) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.partner_api_rate_hit(UUID, TIMESTAMPTZ) TO service_role;

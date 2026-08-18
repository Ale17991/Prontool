-- =========================================================================
-- 0206 — "Esqueci minha senha" (self-service) — controle de abuso
--
-- Até aqui a redefinição de senha só era iniciada por um admin, dentro do
-- sistema, para um usuário que ele já conhecia. Quem esquecia a senha
-- dependia de outra pessoa. Abrir isso ao público (qualquer um digita um
-- e-mail numa tela sem sessão) traz dois abusos que a versão admin não
-- tinha, e é por eles que esta tabela existe:
--
--   1. bombardear a caixa de UMA pessoa pedindo o link mil vezes;
--   2. varrer MUITOS endereços a partir do mesmo lugar, para descobrir
--      quais existem — ou só para queimar nosso domínio de envio.
--
-- Não dá para reusar `public_booking_rate_limits`: ali `tenant_id` é NOT
-- NULL com FK para `tenants`, e quem esqueceu a senha ainda não disse (nem
-- sabe dizer) de que clínica é. Um tenant inventado só para caber na
-- coluna transformaria a chave do limite em ficção.
--
-- O e-mail é guardado HASHEADO, nunca em claro. A linha só precisa
-- responder "quantas vezes este mesmo endereço pediu na última hora?", e
-- para isso igualdade basta. Guardar em claro criaria uma lista de "quem
-- esqueceu a senha e quando" — dado pessoal sem finalidade que justifique
-- a retenção.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.password_reset_requests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- SHA-256 do e-mail normalizado. Ver `hashPasswordResetSubject`.
  email_hash  TEXT NOT NULL,
  ip_hash     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dois índices porque são duas perguntas independentes: "esta caixa está
-- sendo bombardeada?" e "esta origem está varrendo endereços?". Um índice
-- composto serviria só à primeira.
CREATE INDEX IF NOT EXISTS password_reset_email_idx
  ON public.password_reset_requests (email_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS password_reset_ip_idx
  ON public.password_reset_requests (ip_hash, created_at DESC);

ALTER TABLE public.password_reset_requests ENABLE ROW LEVEL SECURITY;
-- Sem policy: a tabela só é tocada pelo service_role, do lado do servidor.
-- Uma policy de leitura por tenant não faria sentido — a linha não tem dono
-- conhecido no momento em que nasce.

GRANT SELECT, INSERT, DELETE ON public.password_reset_requests TO service_role;

COMMENT ON TABLE public.password_reset_requests IS
  'Contador anti-abuso do fluxo público de redefinicao de senha (0206). E-mail e IP apenas em hash; linhas expiradas sao apagadas pelo proprio fluxo.';

-- 0111 — Memed: credenciais de PLATAFORMA (env), não por tenant.
--
-- Modelo de parceiro único: a Clinni é o integrador da Memed. As chaves de
-- produção vivem em variáveis de ambiente no servidor (MEMED_API_KEY /
-- MEMED_SECRET_KEY), configuradas UMA vez — nunca por clínica, nunca no banco.
-- `tenant_memed_config` passa a guardar só: ativado / ambiente / aceite de termo.
--
-- As colunas de chave deixam de ser obrigatórias (NULL para novas ativações).
-- Linhas legadas que ainda tenham chave cifrada continuam válidas (a leitura
-- agora ignora essas colunas e usa o env). Reversível/idempotente.

ALTER TABLE public.tenant_memed_config
  ALTER COLUMN api_key_enc DROP NOT NULL,
  ALTER COLUMN secret_key_enc DROP NOT NULL;

COMMENT ON COLUMN public.tenant_memed_config.api_key_enc IS
  'LEGADO/opcional. As credenciais Memed agora são de plataforma (env MEMED_API_KEY). Mantida nullable por compatibilidade; não é mais lida.';
COMMENT ON COLUMN public.tenant_memed_config.secret_key_enc IS
  'LEGADO/opcional. Ver api_key_enc. Credenciais vêm de env (MEMED_SECRET_KEY).';

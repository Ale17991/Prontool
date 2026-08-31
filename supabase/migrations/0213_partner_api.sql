-- =========================================================================
-- 0213 — API de parceiro (chave, escopo e trilha de acesso)
--
-- A zee.lu precisa consultar QUAIS clínicas usam o serviço dela, puxar o
-- cadastro para abrir a conta lá, e puxar os dados de emissão de nota. Isso é
-- um consumidor de fora do produto, e o produto não tinha por onde recebê-lo:
-- `requireRole` só aceita cookie de sessão ou JWT do Supabase, e dar um usuário
-- de tenant ao parceiro o colocaria DENTRO de uma clínica, com o RBAC de
-- clínica — que é largo demais e do escopo errado.
--
-- Decisões que esta migration materializa:
--
--   D1  A chave é guardada como HASH SHA-256, nunca em claro. Não é senha de
--       gente: são 32 bytes aleatórios, sem dicionário a atacar, então bcrypt
--       só custaria latência em toda requisição. O que importa é que vazar o
--       banco não vaze a chave.
--
--   D2  `key_prefix` é público e fica em claro. É por ele que se identifica
--       QUAL chave usar/revogar sem nunca ter a chave inteira de volta — a
--       parte secreta é mostrada UMA vez, na criação, e nunca mais.
--
--   D3  O ESCOPO da chave é o que ela pode ler, e o RECORTE é sempre o
--       parceiro dono da chave. As duas coisas são independentes: escopo diz
--       "quais recursos", parceiro diz "de quem". Sem o segundo, uma chave com
--       `clinicas:read` leria a base inteira.
--
--   D4  `partner_api_access_log` é append-only. Estamos entregando dado
--       cadastral de clínica a um terceiro; o registro do que saiu, quando e
--       para quem é o que torna a conta auditável em LGPD. Não é log de debug.
--
-- NUNCA sai daqui dado de PACIENTE. A API de parceiro serve clínica e cobrança;
-- não há junção possível com `patients` em nenhuma rota deste conjunto.
--
-- Constituição: III multi-tenant (o recorte por parceiro é o análogo do recorte
-- por tenant); V RBAC (as tabelas são de plataforma, service_role-only).
-- Reversibilidade: aditiva e idempotente.
-- =========================================================================

-- =========================================================================
-- 1. partner_api_keys — credencial do parceiro
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.partner_api_keys (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id      UUID        NOT NULL REFERENCES public.billing_partners(id) ON DELETE CASCADE,
  -- Rótulo de quem usa ("produção zee.lu", "homologação"). Não é secreto.
  name            TEXT        NOT NULL CHECK (length(btrim(name)) > 0),
  -- Parte pública da chave (D2). UNIQUE porque é o índice de busca na
  -- autenticação: acha-se a linha pelo prefixo e compara-se o hash do resto.
  key_prefix      TEXT        NOT NULL UNIQUE CHECK (key_prefix ~ '^[A-Za-z0-9_]{8,32}$'),
  -- SHA-256 hex do segredo (D1).
  key_hash        TEXT        NOT NULL CHECK (key_hash ~ '^[a-f0-9]{64}$'),
  -- O que esta chave pode ler (D3). Array vazio não lê nada — nunca "tudo".
  scopes          TEXT[]      NOT NULL DEFAULT '{}',
  last_used_at    TIMESTAMPTZ NULL,
  -- Revogar é carimbar, não apagar: a trilha de acesso referencia a chave, e
  -- uma chave que sumiu deixaria os acessos dela órfãos justamente na
  -- investigação em que importam.
  revoked_at      TIMESTAMPTZ NULL,
  revoked_reason  TEXT        NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID        NULL REFERENCES auth.users(id)
);

COMMENT ON TABLE public.partner_api_keys IS
  'Credencial de parceiro para a API /api/parceiros/v1. key_hash = SHA-256 do segredo; o segredo e mostrado uma unica vez na criacao. Revogar carimba revoked_at, nunca apaga.';
COMMENT ON COLUMN public.partner_api_keys.scopes IS
  'Escopos concedidos (ex.: clinicas:read, faturamento:read). Vazio = nao le nada.';

CREATE INDEX IF NOT EXISTS partner_api_keys_partner_idx
  ON public.partner_api_keys (partner_id) WHERE revoked_at IS NULL;

ALTER TABLE public.partner_api_keys ENABLE ROW LEVEL SECURITY;
-- Sem policy para `authenticated`: a linha é credencial de plataforma.

-- =========================================================================
-- 2. partner_api_access_log — o que saiu, quando e para quem (D4)
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.partner_api_access_log (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id   UUID        NOT NULL REFERENCES public.billing_partners(id) ON DELETE RESTRICT,
  -- SET NULL e não CASCADE: apagar a chave não pode apagar o histórico de uso
  -- dela. Na prática a chave nunca é apagada (revoga-se), mas o histórico não
  -- pode depender dessa disciplina.
  api_key_id   UUID        NULL REFERENCES public.partner_api_keys(id) ON DELETE SET NULL,
  endpoint     TEXT        NOT NULL,
  -- Preenchido quando o acesso foi a UMA clínica específica; NULL em listagem.
  tenant_id    UUID        NULL REFERENCES public.tenants(id) ON DELETE SET NULL,
  -- Quantas clínicas o parceiro levou nesta chamada. É o que transforma o log
  -- em resposta à pergunta "o que este parceiro já tem sobre a nossa base?".
  result_count INTEGER     NULL,
  status       INTEGER     NOT NULL,
  ip           TEXT        NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.partner_api_access_log IS
  'Append-only. Trilha do dado cadastral de clinica entregue a parceiro externo — evidencia de LGPD, nao log de debug.';

CREATE INDEX IF NOT EXISTS partner_api_access_log_partner_idx
  ON public.partner_api_access_log (partner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS partner_api_access_log_tenant_idx
  ON public.partner_api_access_log (tenant_id, created_at DESC) WHERE tenant_id IS NOT NULL;

DROP TRIGGER IF EXISTS partner_api_access_log_append_only ON public.partner_api_access_log;
CREATE TRIGGER partner_api_access_log_append_only
  BEFORE UPDATE OR DELETE ON public.partner_api_access_log
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only();

ALTER TABLE public.partner_api_access_log ENABLE ROW LEVEL SECURITY;
-- Sem policy para `authenticated`: consulta é do /admin, via service client.

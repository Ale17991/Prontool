-- 0152 — Chat interno da clínica (canal único por tenant).
--
-- Um mural compartilhado por tenant: todos os usuários da clínica leem e escrevem
-- no mesmo canal. `from_name` é denormalizado (nome do remetente no momento do
-- envio) para o realtime/listagem não precisar de join. `kind`:
--   'text'  — mensagem normal (pop-up dispensável no destinatário)
--   'nudge' — "chamar atenção" (sacode a tela + alerta forte; estilo zumbido)
-- Append-only do ponto de vista de conteúdo; só o autor marca deleted_at.
-- A tabela entra na publicação supabase_realtime para entrega em tempo real.
-- Aditiva e idempotente.

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id),
  from_name   TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'nudge')),
  content     TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 4000),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ,
  deleted_by  UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS chat_messages_tenant_idx
  ON public.chat_messages (tenant_id, created_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- Leitura: qualquer usuário do mesmo tenant (necessário também p/ o realtime).
DROP POLICY IF EXISTS chat_messages_read ON public.chat_messages;
CREATE POLICY chat_messages_read ON public.chat_messages
  FOR SELECT
  USING (tenant_id = public.jwt_tenant_id());

-- Escrita: só em nome próprio, dentro do tenant.
DROP POLICY IF EXISTS chat_messages_insert ON public.chat_messages;
CREATE POLICY chat_messages_insert ON public.chat_messages
  FOR INSERT
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND user_id = auth.uid());

-- Soft-delete pelo próprio autor.
DROP POLICY IF EXISTS chat_messages_update ON public.chat_messages;
CREATE POLICY chat_messages_update ON public.chat_messages
  FOR UPDATE
  USING (tenant_id = public.jwt_tenant_id() AND user_id = auth.uid())
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND user_id = auth.uid());

-- Realtime (postgres_changes) precisa de SELECT no role authenticated; a RLS
-- acima restringe as linhas ao tenant do usuário.
GRANT SELECT ON public.chat_messages TO authenticated;

-- Adiciona à publicação do realtime (idempotente).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'chat_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
  END IF;
END $$;

COMMENT ON TABLE public.chat_messages IS
  'Chat interno da clínica — canal único por tenant; kind text/nudge; realtime via supabase_realtime.';

NOTIFY pgrst, 'reload schema';

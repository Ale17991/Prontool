-- 0154 — Chat: conversas diretas 1:1 (além do canal geral).
--
-- `to_user_id` NULL  → mensagem do canal geral da clínica (comportamento 0152).
-- `to_user_id` setado → mensagem direta (DM) para aquele usuário.
-- A leitura passa a liberar: canal geral (todos do tenant) + DMs que eu enviei
-- ou recebi. Isso também segmenta a entrega do Realtime (postgres_changes avalia
-- a policy de SELECT por assinante). Aditiva e idempotente.

ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS to_user_id UUID REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS chat_messages_dm_idx
  ON public.chat_messages (tenant_id, to_user_id, created_at DESC)
  WHERE deleted_at IS NULL AND to_user_id IS NOT NULL;

-- Recria a policy de leitura para incluir as DMs.
DROP POLICY IF EXISTS chat_messages_read ON public.chat_messages;
CREATE POLICY chat_messages_read ON public.chat_messages
  FOR SELECT
  USING (
    tenant_id = public.jwt_tenant_id()
    AND (
      to_user_id IS NULL
      OR to_user_id = auth.uid()
      OR user_id = auth.uid()
    )
  );

NOTIFY pgrst, 'reload schema';

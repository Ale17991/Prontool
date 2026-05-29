-- =============================================================================
-- 0109 — support_tickets: canal interno de bug/sugestao/suporte
-- =============================================================================
-- Objetivo: qualquer usuario logado pode enviar um ticket pelo botao na
-- sidebar. Tickets ficam salvos em DB (historico) E disparam email para o
-- canal de operacoes (operations@homio.com.br) via Resend no app layer.
--
-- Politica de visibilidade:
--   - INSERT: authenticated do proprio tenant (qualquer role).
--   - SELECT: somente admin do proprio tenant (preparado para painel
--             admin futuro; hoje a operacao recebe por email).
--   - UPDATE/DELETE: nao concedidos a authenticated (append-only).
--
-- Sem trigger de audit_log: o ticket em si JA e o registro de auditoria do
-- canal de suporte. Evita complexidade extra com SECURITY DEFINER.
-- =============================================================================

CREATE TABLE public.support_tickets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  kind              TEXT NOT NULL CHECK (kind IN ('bug', 'suggestion', 'support')),
  title             TEXT NOT NULL CHECK (char_length(title) BETWEEN 3 AND 120),
  description       TEXT NOT NULL CHECK (char_length(description) BETWEEN 10 AND 5000),
  status            TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'in_progress', 'resolved', 'wont_fix')),
  -- Contexto util pra triagem (capturado no momento do submit)
  page_url          TEXT,
  user_agent        TEXT,
  -- Cache de identificacao do remetente (evita join custoso em admin panel
  -- e mantem rastreio mesmo se user_id for deletado no futuro).
  user_email_cache  TEXT,
  user_role_cache   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX support_tickets_tenant_created_idx
  ON public.support_tickets (tenant_id, created_at DESC);

CREATE INDEX support_tickets_status_created_idx
  ON public.support_tickets (status, created_at DESC)
  WHERE status IN ('open', 'in_progress');

COMMENT ON TABLE public.support_tickets IS
  'Tickets internos de bug/sugestao/suporte enviados pelos usuarios. Append-only via grants (sem trigger).';
COMMENT ON COLUMN public.support_tickets.kind IS
  'Categoria escolhida pelo usuario no form: bug, suggestion, support.';

-- =============================================================================
-- RLS
-- =============================================================================

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

-- INSERT: qualquer usuario autenticado pode criar ticket pro proprio tenant.
CREATE POLICY support_tickets_insert_own_tenant
  ON public.support_tickets
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = public.jwt_tenant_id());

-- SELECT: admin do proprio tenant ve os tickets (futuro painel admin).
CREATE POLICY support_tickets_select_admin
  ON public.support_tickets
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() = 'admin'
  );

-- service_role tem acesso total (necessario pro email worker e admin tools).
-- Nao precisa policy: service_role bypassa RLS por design do Supabase.

-- =============================================================================
-- GRANTs
-- =============================================================================

REVOKE ALL ON public.support_tickets FROM PUBLIC;
GRANT SELECT, INSERT ON public.support_tickets TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.support_tickets TO service_role;

-- 0163 — Overrides de permissão por usuário (feature 043-permissoes-granulares-admin).
--
-- Ajuste fino de RBAC sobre os 4 papéis fixos: por (tenant, usuário, ação) o
-- admin da clínica pode CONCEDER (grant) ou REVOGAR (deny) uma ação. A permissão
-- efetiva (calculada na aplicação) = (ações do papel) ∪ grants ∖ denies; deny
-- prevalece. Ações financeiras-críticas (price.write, commission.write,
-- appointment.reverse, audit.read/export) são NÃO-overridáveis (Princípio V) —
-- a aplicação rejeita override sobre elas; o banco guarda apenas o que a app
-- gravar.
--
-- Tabela MUTÁVEL (o efeito transiciona / é removido); a trilha fica em audit_log
-- via aplicação. Começa vazia (= comportamento atual). Não-destrutiva.

CREATE TABLE IF NOT EXISTS public.user_permission_overrides (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action      TEXT NOT NULL,
  effect      TEXT NOT NULL CHECK (effect IN ('grant', 'deny')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, action)
);

COMMENT ON TABLE public.user_permission_overrides IS
  'Feature 043 — override de permissão por usuário sobre o papel base (grant/deny). Permissão efetiva calculada na app; deny prevalece. Ações financeiras-críticas não são overridáveis (Princípio V).';

CREATE INDEX IF NOT EXISTS user_permission_overrides_tenant_user_idx
  ON public.user_permission_overrides (tenant_id, user_id);

DROP TRIGGER IF EXISTS user_permission_overrides_touch_updated_at ON public.user_permission_overrides;
CREATE TRIGGER user_permission_overrides_touch_updated_at
  BEFORE UPDATE ON public.user_permission_overrides
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.user_permission_overrides ENABLE ROW LEVEL SECURITY;

-- Leitura: membros autenticados do próprio tenant (a UI mostra o efetivo).
DROP POLICY IF EXISTS user_permission_overrides_read ON public.user_permission_overrides;
CREATE POLICY user_permission_overrides_read ON public.user_permission_overrides
  FOR SELECT TO authenticated
  USING (tenant_id = public.jwt_tenant_id());

GRANT SELECT ON public.user_permission_overrides TO authenticated;

-- Escrita: somente service_role (ops). A aplicação valida ator (admin do tenant
-- ou super-admin), rejeita ações protegidas e audita. Sem policy de escrita
-- para authenticated (o app escreve via service client após requireRole admin).

-- 0087 — Tira `service_role` do bypass do trigger enforce_last_admin.
--
-- Antes (0064:177): `IF current_user IN ('postgres', 'supabase_admin',
-- 'service_role') THEN RETURN NEW`. A rota `/api/configuracoes/usuarios/
-- [userId]/status` usa service_role (via createSupabaseServiceClient),
-- então o trigger não protegia esse caminho. O handler `setTeamMemberStatus`
-- (src/lib/core/team/set-status.ts) já chama `is_last_active_admin` via RPC
-- antes do UPDATE e já trata o erro pelo padrão de mensagem — mas isso
-- depende de o handler lembrar. Tirando service_role do bypass, o DB vira
-- a última linha de defesa para esse cenário (princípio "fail-closed").
--
-- Mantemos `postgres` e `supabase_admin` no bypass para preservar
-- workflows de migração/seed/maintenance que precisam reorganizar
-- vínculos sem o guard.

CREATE OR REPLACE FUNCTION public.enforce_last_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Bypass apenas para roles administrativas do banco — manutenção/seed.
  -- service_role REMOVIDO do bypass: API routes que usam service_role
  -- (após requireRole) agora também são gated pelo trigger; o handler
  -- já trata o erro retornando 409 LAST_ADMIN.
  IF current_user IN ('postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF OLD.role = 'admin' AND OLD.status = 'active'
     AND (NEW.role <> 'admin' OR NEW.status <> 'active')
     AND public.is_last_active_admin(OLD.tenant_id, OLD.user_id) THEN
    RAISE EXCEPTION
      'Não é possível desativar ou rebaixar a única administradora ativa do tenant'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

NOTIFY pgrst, 'reload schema';

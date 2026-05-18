-- 0088 — Endurece is_last_active_admin contra race de duplo-desativar.
--
-- Antes (0064:154): função STABLE SQL fazendo `SELECT NOT EXISTS (...)` sem
-- lock. Em duas transações concorrentes desativando duas admins do mesmo
-- tenant (READ COMMITTED, default), cada uma vê a outra ainda ativa,
-- ambas passam, e o tenant fica com 0 admins ativos.
--
-- Agora: VOLATILE plpgsql com `SELECT ... FOR UPDATE` numa subquery
-- de contagem. PG bloqueia as rows das outras admins ativas; segundo
-- caller espera o primeiro commitar/rollback, então vê o estado real.
--
-- Trade-offs:
--   - VOLATILE em vez de STABLE: sem caching dentro da transação. Como
--     o caller é sempre 1 chamada (handler ou trigger), não impacta.
--   - FOR UPDATE: trava as rows até COMMIT. Tempo de detenção é
--     trivial (1 UPDATE em user_tenants).

CREATE OR REPLACE FUNCTION public.is_last_active_admin(p_tenant_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_other_admin_count INTEGER := 0;
BEGIN
  -- FOR UPDATE serializa: duas transações concorrentes desativando duas
  -- admins do mesmo tenant esperam uma à outra, em vez de cada uma ver
  -- a outra ainda ativa e ambas passarem.
  SELECT COUNT(*)::INTEGER INTO v_other_admin_count
  FROM (
    SELECT 1
    FROM public.user_tenants
    WHERE tenant_id = p_tenant_id
      AND user_id <> p_user_id
      AND role = 'admin'
      AND status = 'active'
    FOR UPDATE
  ) sub;

  RETURN v_other_admin_count = 0;
END $$;

NOTIFY pgrst, 'reload schema';

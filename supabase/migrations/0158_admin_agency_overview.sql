-- 0158 — KPIs consolidados do painel de agência (/admin home).
--
-- Função de leitura cross-tenant (contagens + faturamento somado) para a visão
-- geral do super-admin. Só o service_role executa (o painel /admin usa o service
-- client); REVOKE do public evita vazamento de totais da plataforma para usuários
-- comuns. Aditiva e idempotente.

CREATE OR REPLACE FUNCTION public.admin_agency_overview()
RETURNS json
LANGUAGE sql
SET search_path = public
AS $$
  SELECT json_build_object(
    'clinics_active',     (SELECT count(*) FROM public.tenants WHERE status = 'active'),
    'clinics_suspended',  (SELECT count(*) FROM public.tenants WHERE status = 'suspended'),
    'users_active',       (SELECT count(*) FROM public.user_tenants WHERE status = 'active'),
    'appointments_total', (SELECT count(*) FROM public.appointments),
    'revenue_net_cents',  (SELECT COALESCE(SUM(net_amount_cents), 0) FROM public.appointments_effective),
    'trials',             (SELECT count(*) FROM public.tenant_entitlements WHERE status = 'trial'),
    'past_due',           (SELECT count(*) FROM public.tenant_entitlements WHERE status = 'past_due')
  );
$$;

REVOKE ALL ON FUNCTION public.admin_agency_overview() FROM public;
GRANT EXECUTE ON FUNCTION public.admin_agency_overview() TO service_role;

NOTIFY pgrst, 'reload schema';

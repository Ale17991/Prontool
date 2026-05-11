-- 0068 — CRITICAL SECURITY FIX: views vazando dados cross-tenant.
--
-- INCIDENTE: usuários reportaram ver agendamentos e profissionais de
-- outros tenants em produção (2026-05-11).
--
-- CAUSA RAIZ: 4 views públicas foram criadas com `CREATE VIEW ...` sem
-- a opção `WITH (security_invoker=true)`. Em PostgreSQL, views são
-- legacy SECURITY DEFINER por default — rodam com privilégios do
-- OWNER (postgres, que tem BYPASSRLS). Isso significa que SELECT na
-- view ignora as RLS policies das tabelas subjacentes e retorna
-- dados de TODOS os tenants.
--
-- Affected views:
--   - appointments_effective    (agendamentos / lista de atendimentos)
--   - doctor_commission_current (comissões vigentes / profissionais)
--   - price_versions_with_vigencia (tabelas de preço)
--   - dlq_events                (eventos webhook em DLQ)
--
-- FIX: ALTER VIEW ... SET (security_invoker = true) faz cada view rodar
-- como o caller (RLS aplica). Suportado desde PostgreSQL 15. Sem
-- mudança em definição de view ou em código de aplicação — pure ALTER.
--
-- Referência: https://www.postgresql.org/docs/15/sql-createview.html#id-1.9.3.99.7

ALTER VIEW IF EXISTS public.appointments_effective       SET (security_invoker = true);
ALTER VIEW IF EXISTS public.doctor_commission_current    SET (security_invoker = true);
ALTER VIEW IF EXISTS public.price_versions_with_vigencia SET (security_invoker = true);
ALTER VIEW IF EXISTS public.dlq_events                   SET (security_invoker = true);

-- =========================================================================
-- Verificação manual: depois de aplicar, validar com queries no SQL editor:
--   SELECT relname, reloptions FROM pg_class
--    WHERE relkind = 'v' AND relname IN (
--      'appointments_effective','doctor_commission_current',
--      'price_versions_with_vigencia','dlq_events'
--    );
-- O reloptions de cada uma deve incluir 'security_invoker=true'.
--
-- Em seguida, autenticar como user do tenant A e rodar:
--   SELECT count(*) FROM appointments_effective;
-- O resultado deve ser APENAS o count do tenant A (RLS aplicada).
-- =========================================================================

-- 0169 — GRANT explícito de service_role em tabelas/sequences (fix stack fresco).
--
-- PROBLEMA: num stack recém-migrado com Supabase CLI 2.92 (o do CI e o local
-- atual), o role `service_role` NÃO recebe automaticamente privilégio nas
-- tabelas criadas pelas migrations — o default-privilege do runner não cobre
-- service_role nesse fluxo. Resultado: qualquer cliente service-role (worker de
-- ingestão, harness de teste, seed) leva "permission denied for table tenants"
-- já na primeira query. Bancos antigos (prod, dev criado com CLI velho) não
-- sofrem — herdaram o grant no momento do CREATE TABLE.
--
-- Isto NÃO é um controle de segurança: toda a base assume `service_role` como
-- acesso total (ver 0018_grants.sql linha "service_role keeps full access" e as
-- guardas de 0166/0167, que dizem explicitamente "service_role passa/mantém
-- acesso"). Nenhuma migration revoga tabela de service_role — só EXECUTE de
-- funções, e nunca dele. Tornamos o grant explícito e idempotente: no-op onde
-- já existe (prod), correção onde falta (stack fresco).

GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Mesma lacuna atinge FUNÇÕES: várias migrations fazem
-- `REVOKE ALL ON FUNCTION ... FROM PUBLIC; GRANT EXECUTE TO anon, authenticated`
-- (0093, 0095, 0096, 0113, 0115, 0134, 0158, 0161, 0166) e esquecem service_role.
-- Em stack fresco ele perde o EXECUTE (só o tinha via PUBLIC) → 42501 ao chamar,
-- p.ex., public_booking_resolve_slug pelo cliente service-role. As guardas
-- internas por jwt_role continuam valendo; service_role é o role confiável.
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- Objetos criados por migrations FUTURAS (mesmo runner) herdam o grant.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;

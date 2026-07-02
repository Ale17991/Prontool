-- 0170 — test_truncate_all_mutable DINÂMICO + restauração de catálogos.
--
-- PROBLEMA 1 (isolamento): a lista de tabelas em 0020 era FIXA — só cobria as
-- features 001-004. Dezenas de tabelas novas nunca eram truncadas → dados
-- vazavam entre arquivos (repasse "818000 vs 18000", relatórios contaminados,
-- APPOINTMENT_CONFLICT, "null to deeply equal []"). Correção: enumerar
-- dinamicamente TODAS as tabelas ordinárias de `public` e truncar tudo (menos
-- tabelas de extensão como spatial_ref_sys).
--
-- PROBLEMA 2 (catálogos + performance): catálogos são seedados pelas migrations
-- e lidos por muitos testes. Se PRESERVADOS (não truncados), acumulam dados de
-- teste sem parar (tuss_codes cresce a cada seedTussCode) → queries e o próprio
-- reset ficam lentos e o `test_truncate_all_mutable` estoura o statement_timeout
-- no meio da suíte (resetDatabase "canceling statement due to statement
-- timeout"), deixando o banco em estado parcial → falhas em cascata e
-- order-dependent nos arquivos seguintes (42501, null=[], 0 e-mails).
-- Correção: TRUNCAR os catálogos também (sem acúmulo) e RESTAURAR ao baseline
-- (estado semeado) a cada reset. O baseline é capturado LAZY na 1ª chamada
-- (antes de qualquer mutação). Listas de coluna vêm de `pg_attribute` (catálogo
-- rápido) — `information_schema.columns` é uma view cara e era chamada 8x por
-- reset. Em produção a função nunca roda → schema catalog_baseline não é criado.

CREATE OR REPLACE FUNCTION public.test_truncate_all_mutable(wipe_catalog BOOLEAN DEFAULT FALSE)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
-- Sem limite de tempo: truncar ~100 tabelas + restaurar catálogos pode passar
-- do statement_timeout do PostgREST sob contenção de lock no meio da suíte
-- (era a causa de "resetDatabase: canceling statement due to statement timeout"
-- → banco em estado parcial → falhas em cascata order-dependent).
SET statement_timeout = '0'
AS $$
DECLARE
  v_list TEXT;
  v_ready BOOLEAN;
  v_cat TEXT;
  v_cols TEXT;
  v_cats TEXT[];
BEGIN
  -- Baseline lazy: a 1ª chamada acontece antes de qualquer teste mutar catálogo.
  CREATE SCHEMA IF NOT EXISTS catalog_baseline;
  SELECT to_regclass('catalog_baseline._ready') IS NOT NULL INTO v_ready;
  IF NOT v_ready THEN
    CREATE TABLE catalog_baseline.tuss_catalog_versions AS TABLE public.tuss_catalog_versions;
    CREATE TABLE catalog_baseline.tuss_codes            AS TABLE public.tuss_codes;
    CREATE TABLE catalog_baseline.dental_status_catalog AS TABLE public.dental_status_catalog;
    CREATE TABLE catalog_baseline.cid10_codes           AS TABLE public.cid10_codes;
    CREATE TABLE catalog_baseline.tiss_domain_tables    AS TABLE public.tiss_domain_tables;
    CREATE TABLE catalog_baseline.patient_metric_types  AS TABLE public.patient_metric_types;
    CREATE TABLE catalog_baseline.plan_prices           AS TABLE public.plan_prices;
    CREATE TABLE catalog_baseline.platform_admins       AS TABLE public.platform_admins;
    CREATE TABLE catalog_baseline._ready ();
  END IF;

  -- Trunca TODAS as tabelas ordinárias de public (inclusive catálogos — sem
  -- acúmulo), exceto tabelas de extensão.
  SELECT string_agg(format('public.%I', c.relname), ', ')
    INTO v_list
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e'
    );
  IF v_list IS NOT NULL THEN
    EXECUTE 'TRUNCATE ' || v_list || ' RESTART IDENTITY CASCADE';
  END IF;

  -- Restaura os catálogos ao baseline (ordem de FK: versions → codes → resto).
  -- `tuss_*` só quando NÃO é wipe (os 3 testes wipeCatalog querem tuss vazio).
  -- Colunas explícitas via pg_attribute, EXCLUINDO geradas (attgenerated <> '').
  IF wipe_catalog THEN
    v_cats := ARRAY['dental_status_catalog', 'cid10_codes', 'tiss_domain_tables',
                    'patient_metric_types', 'plan_prices', 'platform_admins'];
  ELSE
    v_cats := ARRAY['tuss_catalog_versions', 'tuss_codes', 'dental_status_catalog',
                    'cid10_codes', 'tiss_domain_tables', 'patient_metric_types',
                    'plan_prices', 'platform_admins'];
  END IF;

  FOREACH v_cat IN ARRAY v_cats LOOP
    SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum)
      INTO v_cols
    FROM pg_attribute
    WHERE attrelid = ('public.' || v_cat)::regclass
      AND attnum > 0 AND NOT attisdropped AND attgenerated = '';
    EXECUTE format(
      'INSERT INTO public.%I (%s) SELECT %s FROM catalog_baseline.%I',
      v_cat, v_cols, v_cols, v_cat
    );
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.test_truncate_all_mutable(BOOLEAN) TO service_role;

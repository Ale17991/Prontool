-- 0170 — test_truncate_all_mutable DINÂMICO + restauração de catálogos.
--
-- PROBLEMA 1 (isolamento): a lista de tabelas em 0020 era FIXA — só cobria as
-- features 001-004. Dezenas de tabelas novas (expenses, installment_payments,
-- monthly_payouts, appointment_procedures, perio_*, tiss_*, tasks, notifications,
-- dental_chart_entries, patient_measurements, ...) NUNCA eram truncadas → dados
-- vazavam entre arquivos (repasse "818000 vs 18000", relatórios contaminados,
-- APPOINTMENT_CONFLICT, "null to deeply equal []"). Correção: enumerar
-- dinamicamente TODAS as tabelas ordinárias de `public` e truncar tudo exceto
-- os catálogos de referência e as tabelas de extensão (spatial_ref_sys).
--
-- PROBLEMA 2 (catálogos esvaziados): os catálogos são seedados pelas migrations
-- e lidos por muitos testes, mas VÁRIOS testes os esvaziam sem restaurar:
--   • `wipeCatalog:true` (3 testes) trunca `tuss_codes` com CASCADE, que
--     CASCATEIA em `dental_status_catalog` (FK) e zera `tuss_catalog_versions`;
--   • o `TRUNCATE tenants ... CASCADE` cascateia em `patient_metric_types`.
-- Como o seed só roda uma vez (no reset), depois de um wipeCatalog os arquivos
-- seguintes viam catálogo vazio → odontograma "Cannot read null.id",
-- migration-0053 sem a linha `ans_official_202501`, etc. Correção: capturar o
-- BASELINE dos catálogos (lazy, na 1ª chamada — antes de qualquer mutação de
-- teste) e RESTAURAR após cada truncate. Em produção a função nunca roda, então
-- o schema `catalog_baseline` não é criado.

CREATE OR REPLACE FUNCTION public.test_truncate_all_mutable(wipe_catalog BOOLEAN DEFAULT FALSE)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  -- Catálogos de referência (globais). Não entram no truncate dinâmico, mas
  -- podem ser esvaziados por CASCADE/wipe → restaurados do baseline no fim.
  v_preserve TEXT[] := ARRAY[
    'tuss_codes', 'tuss_catalog_versions', 'dental_status_catalog',
    'cid10_codes', 'tiss_domain_tables', 'patient_metric_types',
    'plan_prices', 'platform_admins'
  ];
  v_list TEXT;
  v_ready BOOLEAN;
  v_cat TEXT;
  v_cols TEXT;
  v_cats TEXT[];
BEGIN
  -- Baseline lazy: a 1ª chamada acontece antes de qualquer teste mutar catálogo,
  -- então o estado atual É o semeado pelas migrations.
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

  SELECT string_agg(format('public.%I', c.relname), ', ')
    INTO v_list
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relname <> ALL(v_preserve)
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e'
    );

  IF v_list IS NOT NULL THEN
    EXECUTE 'TRUNCATE ' || v_list || ' RESTART IDENTITY CASCADE';
  END IF;

  IF wipe_catalog THEN
    TRUNCATE public.tuss_codes, public.tuss_catalog_versions RESTART IDENTITY CASCADE;
  END IF;

  -- Restaura os catálogos ao baseline (ordem de FK: versions → codes → resto).
  -- `tuss_*` só quando NÃO é wipe (os 3 testes wipeCatalog querem tuss vazio).
  -- Lista de colunas explícita EXCLUINDO geradas (ex.: tuss_codes.tuss_table_label
  -- GENERATED ALWAYS) — `SELECT *` inseriria a coluna gerada e falharia.
  IF wipe_catalog THEN
    v_cats := ARRAY['dental_status_catalog', 'cid10_codes', 'tiss_domain_tables',
                    'patient_metric_types', 'plan_prices', 'platform_admins'];
  ELSE
    v_cats := ARRAY['tuss_catalog_versions', 'tuss_codes', 'dental_status_catalog',
                    'cid10_codes', 'tiss_domain_tables', 'patient_metric_types',
                    'plan_prices', 'platform_admins'];
  END IF;

  FOREACH v_cat IN ARRAY v_cats LOOP
    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
      INTO v_cols
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = v_cat AND is_generated = 'NEVER';
    EXECUTE format(
      'INSERT INTO public.%I (%s) SELECT %s FROM catalog_baseline.%I ON CONFLICT DO NOTHING',
      v_cat, v_cols, v_cols, v_cat
    );
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.test_truncate_all_mutable(BOOLEAN) TO service_role;

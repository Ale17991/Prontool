-- 0170 — test_truncate_all_mutable DINÂMICO (fix isolamento entre arquivos de teste).
--
-- PROBLEMA: a lista de tabelas em 0020 era FIXA — só cobria as features 001-004
-- (tenants, doctors, patients, appointments, price_versions, etc.). Dezenas de
-- tabelas criadas depois (expenses, installment_payments, monthly_payouts,
-- appointment_procedures, appointment_assistants, perio_*, tiss_*, tasks,
-- notifications, dental_chart_entries, patient_measurements, ...) NUNCA eram
-- truncadas entre arquivos → dados vazavam de um teste pro outro. Sintomas na
-- suíte completa (passavam isolados): repasse "818000 vs 18000", relatórios com
-- total contaminado ou zerado, APPOINTMENT_CONFLICT em slot já ocupado por outro
-- teste, "expected null to deeply equal []".
--
-- CORREÇÃO: enumerar dinamicamente TODAS as tabelas ordinárias de `public` e
-- truncar tudo, exceto (a) os catálogos de referência seed-once (globais) e
-- (b) tabelas pertencentes a extensões (ex.: spatial_ref_sys). Assim novas
-- tabelas passam a ser limpas automaticamente, sem manutenção da lista.
-- `wipe_catalog=true` mantém a semântica antiga: também zera o catálogo TUSS.

CREATE OR REPLACE FUNCTION public.test_truncate_all_mutable(wipe_catalog BOOLEAN DEFAULT FALSE)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  -- Catálogos/reference tables: seedados uma vez (por migration ou script) e
  -- lidos por muitos testes. Truncar aqui reintroduziria "Cannot read null.id"
  -- e "METRIC_TYPE_UNKNOWN". Preservados por padrão.
  v_preserve TEXT[] := ARRAY[
    'tuss_codes', 'tuss_catalog_versions', 'dental_status_catalog',
    'cid10_codes', 'tiss_domain_tables', 'patient_metric_types',
    'plan_prices', 'platform_admins'
  ];
  v_list TEXT;
BEGIN
  SELECT string_agg(format('public.%I', c.relname), ', ')
    INTO v_list
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'                        -- só tabelas ordinárias (não views/partições-pai)
    AND c.relname <> ALL(v_preserve)
    AND NOT EXISTS (                            -- pula tabelas de extensão (spatial_ref_sys, etc.)
      SELECT 1 FROM pg_depend d
      WHERE d.objid = c.oid AND d.deptype = 'e'
    );

  IF v_list IS NOT NULL THEN
    EXECUTE 'TRUNCATE ' || v_list || ' RESTART IDENTITY CASCADE';
  END IF;

  IF wipe_catalog THEN
    TRUNCATE public.tuss_codes, public.tuss_catalog_versions RESTART IDENTITY CASCADE;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.test_truncate_all_mutable(BOOLEAN) TO service_role;

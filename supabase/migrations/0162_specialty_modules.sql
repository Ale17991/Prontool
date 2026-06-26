-- 0162 — Módulos de especialidade (feature 042-modulos-especialidade).
--
-- Transforma o módulo `tiss` em `convenio` e introduz `odonto` e `oftalmo`.
-- Faz o backfill de `tenant_entitlements.modules`:
--   1. renomeia 'tiss' -> 'convenio' (dedup);
--   2. auto-ativa `convenio`/`odonto`/`oftalmo` para tenants com USO REAL
--      (clarificação Q1: mera existência de convênio cadastrado NÃO conta).
--
-- Sinais de uso real (read-only):
--   convenio: ≥1 appointment_procedures.plan_id  OU  tenant_tiss_operator_config  OU  tiss_guias
--   odonto:   dental_chart_entries               OU  perio_exams
--   oftalmo:  ophthalmology_exams
--
-- Idempotente (DISTINCT + rename já-aplicado vira no-op) e não-destrutiva
-- (nenhum módulo é removido além do rename; nenhum dado de domínio é tocado).
-- `tenant_entitlements.modules` é configuração mutável (a função
-- set_tenant_entitlement já faz UPSERT/UPDATE) — não fere a imutabilidade
-- financeira (Princípio I). Tenants `legacy` recebem todos os módulos via
-- código (buildEntitlements); aplicar aqui apenas mantém os dados coerentes
-- e garante que nenhum tenant fique com 'tiss' remanescente (SC-005).

UPDATE public.tenant_entitlements te
SET modules = (
  SELECT ARRAY(
    SELECT DISTINCT m
    FROM unnest(
      -- 1) módulos atuais com tiss -> convenio
      COALESCE(
        (SELECT array_agg(CASE WHEN x = 'tiss' THEN 'convenio' ELSE x END)
           FROM unnest(COALESCE(te.modules, ARRAY[]::text[])) AS x),
        ARRAY[]::text[]
      )
      -- 2) convenio por uso real
      || CASE
           WHEN EXISTS (SELECT 1 FROM public.appointment_procedures ap
                         WHERE ap.tenant_id = te.tenant_id AND ap.plan_id IS NOT NULL)
             OR EXISTS (SELECT 1 FROM public.tenant_tiss_operator_config tc
                         WHERE tc.tenant_id = te.tenant_id)
             OR EXISTS (SELECT 1 FROM public.tiss_guias tg
                         WHERE tg.tenant_id = te.tenant_id)
           THEN ARRAY['convenio'] ELSE ARRAY[]::text[] END
      -- 3) odonto por uso real
      || CASE
           WHEN EXISTS (SELECT 1 FROM public.dental_chart_entries dce
                         WHERE dce.tenant_id = te.tenant_id)
             OR EXISTS (SELECT 1 FROM public.perio_exams pe
                         WHERE pe.tenant_id = te.tenant_id)
           THEN ARRAY['odonto'] ELSE ARRAY[]::text[] END
      -- 4) oftalmo por uso real
      || CASE
           WHEN EXISTS (SELECT 1 FROM public.ophthalmology_exams oe
                         WHERE oe.tenant_id = te.tenant_id)
           THEN ARRAY['oftalmo'] ELSE ARRAY[]::text[] END
    ) AS m
  )
);

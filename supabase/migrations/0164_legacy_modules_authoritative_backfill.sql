-- 0164 — Lista de módulos das clínicas LEGADAS volta a ser autoritativa.
--
-- Problema: `buildEntitlements` forçava TODOS os módulos no plano 'legacy'
-- (grandfather), então desativar módulo no /admin não fazia efeito (métricas
-- metabólicas/treino/dieta continuavam aparecendo). O código passou a respeitar
-- a lista `tenant_entitlements.modules` no legacy; lista VAZIA continua = acesso
-- total (defensivo).
--
-- Este backfill popula com o conjunto COMPLETO de módulos contratáveis apenas
-- as clínicas legadas cuja lista está VAZIA/NULA — assim elas ficam curáveis no
-- /admin (toggles refletem a realidade) sem perder acesso. Clínicas legadas que
-- JÁ têm uma lista (ex.: onde o admin já desativou algo) são preservadas.
--
-- Conjunto completo = todos os módulos contratáveis EXCETO telemedicina
-- (ainda "em breve"). Idempotente (cardinality>0 após rodar → não re-aplica).

UPDATE public.tenant_entitlements
   SET modules = ARRAY['convenio','odonto','oftalmo','portal_paciente','crm','treino','dieta','endocrino'],
       updated_at = now()
 WHERE plan = 'legacy'
   AND (modules IS NULL OR cardinality(modules) = 0);

NOTIFY pgrst, 'reload schema';

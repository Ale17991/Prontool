-- 0157 — Backfill dos módulos das clínicas legadas.
--
-- O código deixou de FORÇAR todos os módulos no plano 'legacy' (a lista
-- tenant_entitlements.modules virou autoritativa, para o /admin conseguir
-- desativar módulo por clínica). Para nenhuma clínica legada perder acesso
-- nessa virada, preenchemos a lista com todos os módulos contratáveis (exceto
-- telemedicina, que é "em breve"). A partir daí o admin liga/desliga à vontade.
--
-- IMPORTANTE: se você já tinha tentado desativar módulos numa clínica legada
-- (não fazia efeito antes), eles voltam LIGADOS aqui — basta desativar de novo
-- no /admin que agora vale.

UPDATE public.tenant_entitlements
   SET modules = ARRAY['tiss','portal_paciente','crm','treino','dieta','endocrino'],
       updated_at = now()
 WHERE plan = 'legacy';

NOTIFY pgrst, 'reload schema';

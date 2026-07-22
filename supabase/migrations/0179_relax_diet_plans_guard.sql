-- 0179 — Relaxa o column-guard de diet_plans para o rascunho editável (047).
--
-- A feature 032 travou diet_plans em append-only de versão (só active/updated_at
-- mudam), no modelo "novo plano = nova versão". A 047 introduz um RASCUNHO
-- editável (status rascunho→prescrito, título, meta da avaliação) — a
-- prescrição precisa marcar `status='prescrito'` e o rascunho precisa atualizar
-- título/meta enquanto editado.
--
-- Isto NÃO enfraquece a Constituição I: a imutabilidade que importa está na
-- `diet_plan_prescriptions` (append-only, snapshot congelado — 0176). O plano
-- de trabalho (diet_plans) é rascunho por natureza; o artefato ENTREGUE ao
-- paciente (a prescrição) é que é imutável.

DROP TRIGGER IF EXISTS diet_plans_append_only ON public.diet_plans;
CREATE TRIGGER diet_plans_append_only BEFORE UPDATE OR DELETE ON public.diet_plans
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only_columns(
    'active,updated_at,status,title,notes,assessment_id,target_kcal,target_macros'
  );

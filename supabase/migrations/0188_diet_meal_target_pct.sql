-- 0188 — Meta por refeição: distribuição dos macros ao longo do dia.
--
-- A avaliação (046) diz quanto o paciente precisa por dia; o plano (047) diz o
-- que ele vai comer. Faltava o meio de campo — quanto cabe em CADA refeição.
-- Sem isso a nutricionista só descobre que pesou a mão no café da manhã depois
-- de montar o dia inteiro e ver o total estourar.
--
-- Uma coluna nullable em `diet_meals` basta: a fatia é do PLANO (é ali que as
-- refeições existem), e NULL significa "esta refeição não tem meta própria" —
-- estado legítimo, e diferente de 0%, que é uma meta de não comer nada.
--
-- Sem tabela nova e sem tocar no column-guard: a 0179 protege `diet_plans`, e
-- as refeições são regravadas inteiras a cada save do rascunho.

ALTER TABLE public.diet_meals
  ADD COLUMN IF NOT EXISTS target_pct NUMERIC(5,2) NULL
  CHECK (target_pct IS NULL OR (target_pct >= 0 AND target_pct <= 100));

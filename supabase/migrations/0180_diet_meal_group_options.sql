-- 0180 — Opções de grupo editáveis por paciente (feature 047).
--
-- Um grupo (lista de substituição) adicionado a uma refeição do plano precisa
-- ser personalizável POR PACIENTE: a nutricionista remove opções que aquele
-- paciente não come e adiciona outras — sem alterar a lista global reutilizável.
--
-- `group_options` guarda o conjunto EFETIVO de opções daquele item de refeição,
-- como array JSONB de { food_id, grams }. NULL = usa a lista base (equivalence
-- list) como está. A energia-alvo do grupo segue vindo da lista (reference_kcal);
-- estas opções só definem QUAIS trocas aparecem para este paciente.
--
-- Aditiva/nullable — não quebra plano existente. Reversível: supabase:reset
-- recria; DROP COLUMN a remove sem perda de dado estrutural.

ALTER TABLE public.diet_meal_items
  ADD COLUMN IF NOT EXISTS group_options JSONB NULL;

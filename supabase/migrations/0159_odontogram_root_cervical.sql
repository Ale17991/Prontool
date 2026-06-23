-- 0159 — Odontograma: regiões raiz e cervical (backlog odonto).
--
-- Estende as faces aceitas em dental_chart_entries para incluir:
--   cervical — colo do dente (restaurações cervicais)
--   raiz     — raiz/canal (endodontia; não é feito na coroa)
-- O nome da constraint inline é dental_chart_entries_surface_check (confirmado
-- via pg_constraint). Aditiva e idempotente.

ALTER TABLE public.dental_chart_entries
  DROP CONSTRAINT IF EXISTS dental_chart_entries_surface_check;

ALTER TABLE public.dental_chart_entries
  ADD CONSTRAINT dental_chart_entries_surface_check
  CHECK (
    surface IS NULL OR
    surface IN ('mesial','distal','occlusal_incisal','vestibular','lingual_palatal','cervical','raiz')
  );

NOTIFY pgrst, 'reload schema';

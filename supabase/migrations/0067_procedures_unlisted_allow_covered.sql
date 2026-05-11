-- 0067 — Permite procedimentos "não listados" cobertos por plano.
--
-- Revisão da 0066: a constraint procedures_unlisted_not_covered forçava
-- covered_by_plan=false quando is_unlisted=true. Caso de uso real
-- contradiz: pacotes negociados entre o médico e o plano podem ser
-- procedimentos sem TUSS oficial mas cobertos por convênio específico.
-- Esses pacotes têm preço por plano em price_versions normalmente
-- (linked por procedure_id, não tuss_code), então o modelo já suporta —
-- só faltava remover a barreira artificial.
--
-- As demais constraints da 0066 (tuss_code IS NULL <=> is_unlisted,
-- display_name obrigatório quando unlisted) permanecem.

ALTER TABLE public.procedures
  DROP CONSTRAINT IF EXISTS procedures_unlisted_not_covered;

COMMENT ON COLUMN public.procedures.is_unlisted IS
  'true = procedimento local sem código TUSS oficial. Implica tuss_code=NULL e display_name obrigatório. Pode ser coberto por plano (pacotes negociados) ou particular — decidido por covered_by_plan independentemente.';

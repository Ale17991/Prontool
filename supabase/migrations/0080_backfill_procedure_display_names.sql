-- Migration 0080 — Backfill display_name dos procedimentos TUSS-listados
-- a partir de tuss_codes.description.
--
-- Contexto: procedimentos cadastrados sem display_name manual estavam
-- aparecendo como "(sem nome de exibição)" no front. A correção em
-- src/lib/core/procedures/create.ts ja resolve novos cadastros (auto-
-- preenche a partir do catalogo TUSS quando o caller deixa em branco).
-- Esta migration corrige os ja existentes.
--
-- Criterio: tuss_code IS NOT NULL (so listados) + display_name IS NULL
-- ou string vazia. Procedimentos unlisted ja exigem display_name por
-- constraint, entao nao entram aqui.
--
-- Idempotente: rodar varias vezes nao causa efeito colateral; o WHERE
-- naturalmente filtra os ja resolvidos.

UPDATE public.procedures p
SET display_name = tc.description
FROM public.tuss_codes tc
WHERE p.tuss_code = tc.code
  AND (p.display_name IS NULL OR length(trim(p.display_name)) = 0)
  AND p.tuss_code IS NOT NULL
  AND tc.description IS NOT NULL
  AND length(trim(tc.description)) > 0;

-- Sem NOTIFY pgrst — schema nao muda; somente dados.

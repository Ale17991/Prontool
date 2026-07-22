-- 0177 — RPC de busca de alimentos (feature 047, US1).
--
-- A busca precisa ser acento-insensível e tolerante a erro de digitação sobre
-- milhares de alimentos, usando o índice trigram GIN da 0176. O PostgREST não
-- expressa `immutable_unaccent(lower(name)) LIKE ...` num filtro de query, então
-- encapsulamos numa RPC. SECURITY DEFINER + p_tenant_id explícito segue o modelo
-- do resto do código (service client + escopo de tenant no argumento).
--
-- Escopo: 'all' = catálogo global + alimentos próprios da clínica; 'custom' =
-- só os da clínica. Alimentos próprios vêm primeiro; depois por similaridade.

CREATE OR REPLACE FUNCTION public.search_foods(
  p_tenant_id UUID,
  p_query     TEXT DEFAULT NULL,
  p_group     TEXT DEFAULT NULL,
  p_scope     TEXT DEFAULT 'all',
  p_limit     INT  DEFAULT 20
)
RETURNS TABLE (
  id              UUID,
  tenant_id       UUID,
  source          TEXT,
  name            TEXT,
  group_slug      TEXT,
  group_label     TEXT,
  reference_grams NUMERIC,
  energy_kcal     NUMERIC,
  protein_g       NUMERIC,
  carb_g          NUMERIC,
  fat_g           NUMERIC,
  fiber_g         NUMERIC
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT f.id, f.tenant_id, f.source, f.name, g.slug, g.label,
         f.reference_grams, f.energy_kcal, f.protein_g, f.carb_g, f.fat_g, f.fiber_g
  FROM public.foods f
  LEFT JOIN public.food_groups g ON g.id = f.group_id
  WHERE f.active
    AND (
      CASE WHEN p_scope = 'custom'
           THEN f.tenant_id = p_tenant_id
           ELSE (f.tenant_id IS NULL OR f.tenant_id = p_tenant_id)
      END
    )
    AND (p_group IS NULL OR g.slug = p_group)
    AND (
      p_query IS NULL OR length(trim(p_query)) < 2
      OR public.immutable_unaccent(lower(f.name)) LIKE
         '%' || public.immutable_unaccent(lower(p_query)) || '%'
    )
  ORDER BY
    (f.tenant_id IS NOT NULL) DESC,  -- alimentos próprios da clínica primeiro
    CASE
      WHEN p_query IS NULL OR length(trim(p_query)) < 2 THEN 0
      ELSE extensions.similarity(
             public.immutable_unaccent(lower(f.name)),
             public.immutable_unaccent(lower(p_query)))
    END DESC,
    f.name
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);
$$;

GRANT EXECUTE ON FUNCTION public.search_foods(UUID, TEXT, TEXT, TEXT, INT) TO authenticated, service_role;

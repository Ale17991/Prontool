-- 0181 — Micronutrientes na base de alimentos (feature 049, US1).
--
-- Estende `foods` com um mapa JSONB de micronutrientes por porção de referência
-- (`nutrient_key → valor`), ex.: {"calcio_mg": 8, "ferro_mg": 2.81, ...}. Chave
-- ausente = dado desconhecido (não zero). As chaves canônicas vivem no catálogo
-- TS `src/lib/core/nutrition/micronutrients.ts`; a soma do plano/recordatório
-- itera as chaves genericamente (regra de três).
--
-- Aditiva/nullable — não quebra alimento/plano existente. Os alimentos globais
-- (tenant_id NULL) são restaurados do `catalog_baseline` no reset dos testes; a
-- coluna nova é incluída automaticamente (restore usa lista de colunas dinâmica
-- via pg_attribute — ver 0170). O seed dos valores é feito por script
-- (`scripts/build-foods-micros.ts`), não nesta migration.
--
-- Reversibilidade: aditiva, idempotente. supabase:reset recria.

ALTER TABLE public.foods
  ADD COLUMN IF NOT EXISTS micronutrients JSONB NULL;

-- Nova origem de base global: `af_bdalimentos` (aba BD ALIMENTOS da AF, com
-- micronutrientes). Estende o CHECK de `source` (antes: taco/ibge_pof/tbca/custom).
ALTER TABLE public.foods DROP CONSTRAINT IF EXISTS foods_source_check;
ALTER TABLE public.foods ADD CONSTRAINT foods_source_check
  CHECK (source = ANY (ARRAY['taco','ibge_pof','tbca','custom','af_bdalimentos']));

-- Refaz o snapshot de `foods` no catalog_baseline (0170) para incluir a coluna
-- nova — senão o restore do reset dos testes (INSERT ... SELECT com lista de
-- colunas dinâmica) falha por divergência de schema. No-op num DB fresco (o
-- baseline é capturado lazy DEPOIS das migrations, já com a coluna).
DO $$ BEGIN
  IF to_regclass('catalog_baseline.foods') IS NOT NULL THEN
    DROP TABLE catalog_baseline.foods;
    CREATE TABLE catalog_baseline.foods AS TABLE public.foods;
  END IF;
END $$;

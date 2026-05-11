-- 0066 — Procedimentos "não listados".
--
-- Permite cadastrar procedimentos sem código TUSS (ex.: serviço local
-- sem catalogação oficial). Quando is_unlisted = true:
--   - tuss_code é NULL (sem FK, sem validação contra o catálogo global)
--   - display_name é obrigatório (sem TUSS pra fallback de descrição)
--   - covered_by_plan deve ser false (sem TUSS, não entra em convênios)
--
-- Quando is_unlisted = false, comportamento atual preservado (tuss_code
-- NOT NULL, valida via trigger TUSS, UNIQUE por tenant).
--
-- Reversibilidade: aditiva e idempotente. Constraints CHECK e partial
-- unique index podem ser droppados pra rollback parcial. Nenhuma linha
-- pré-existente é afetada (todas têm is_unlisted = false por default).

-- =========================================================================
-- (a) Coluna is_unlisted + tuss_code passa a aceitar NULL
-- =========================================================================
ALTER TABLE public.procedures
  ADD COLUMN IF NOT EXISTS is_unlisted BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.procedures
  ALTER COLUMN tuss_code DROP NOT NULL;

-- =========================================================================
-- (b) CHECKs de consistência
-- =========================================================================

-- tuss_code IS NULL <=> is_unlisted (XOR-like)
ALTER TABLE public.procedures
  DROP CONSTRAINT IF EXISTS procedures_tuss_code_consistency;
ALTER TABLE public.procedures
  ADD CONSTRAINT procedures_tuss_code_consistency
  CHECK (
    (is_unlisted AND tuss_code IS NULL)
    OR (NOT is_unlisted AND tuss_code IS NOT NULL)
  );

-- display_name obrigatório quando unlisted
ALTER TABLE public.procedures
  DROP CONSTRAINT IF EXISTS procedures_unlisted_display_name_required;
ALTER TABLE public.procedures
  ADD CONSTRAINT procedures_unlisted_display_name_required
  CHECK (
    NOT is_unlisted
    OR (display_name IS NOT NULL AND length(btrim(display_name)) > 0)
  );

-- unlisted force covered_by_plan = false (não existe em tabela TUSS,
-- não pode entrar em coverage de convênio)
ALTER TABLE public.procedures
  DROP CONSTRAINT IF EXISTS procedures_unlisted_not_covered;
ALTER TABLE public.procedures
  ADD CONSTRAINT procedures_unlisted_not_covered
  CHECK (
    NOT is_unlisted OR NOT covered_by_plan
  );

-- =========================================================================
-- (c) UNIQUE constraint → partial unique index
-- =========================================================================
-- A constraint original (migration 0004) é UNIQUE (tenant_id, tuss_code).
-- Com tuss_code aceitando NULL, ela impediria múltiplos não listados
-- (porque NULL <> NULL, mas múltiplas NULLs ainda colidem em UNIQUE
-- antigo do PG <15 em algumas configs). Substituímos por partial unique
-- index que filtra is_unlisted = false — múltiplos unlisted por tenant OK.

ALTER TABLE public.procedures
  DROP CONSTRAINT IF EXISTS procedures_tenant_id_tuss_code_key;

CREATE UNIQUE INDEX IF NOT EXISTS procedures_tenant_tuss_listed_unique
  ON public.procedures (tenant_id, tuss_code)
  WHERE NOT is_unlisted;

-- =========================================================================
-- (d) Trigger TUSS validator skip-a quando unlisted
-- =========================================================================
CREATE OR REPLACE FUNCTION public.enforce_tuss_code_active_on_procedure()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  hit RECORD;
BEGIN
  -- Procedimento "não listado" não tem código TUSS para validar.
  IF NEW.is_unlisted THEN
    RETURN NEW;
  END IF;

  SELECT code, valid_to INTO hit
  FROM public.tuss_codes
  WHERE code = NEW.tuss_code;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TUSS_CODE_UNKNOWN: code=% not found in catalog', NEW.tuss_code;
  END IF;

  IF hit.valid_to IS NOT NULL AND hit.valid_to < CURRENT_DATE THEN
    RAISE EXCEPTION 'TUSS_CODE_RETIRED: code=% was retired on %', NEW.tuss_code, hit.valid_to;
  END IF;

  RETURN NEW;
END $$;

-- Trigger e FK já existem das migrations 0014/0024/0036 — não recriamos.
-- FK procedures_tuss_code_fkey permite NULL nativamente (PG não checa FK
-- para colunas NULL), então não precisa de mudança.

COMMENT ON COLUMN public.procedures.is_unlisted IS
  'true = procedimento local sem código TUSS oficial. Implica tuss_code=NULL, display_name obrigatório, covered_by_plan=false.';

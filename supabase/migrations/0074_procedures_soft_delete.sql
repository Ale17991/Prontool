-- 0074 — Soft delete em procedures.
--
-- Procedimentos sao referenciados por appointments, appointment_procedures,
-- price_versions e treatment_plan_steps com ON DELETE RESTRICT. Hard delete
-- e impossivel pra qualquer procedimento ja usado. Soft delete via
-- deleted_at preserva os registros historicos e remove o procedimento das
-- listagens de selecao.
--
-- Diferenca pra `active`:
--   - `active=false` (toggle) e reversivel — admin pode reativar.
--   - `deleted_at IS NOT NULL` e a remocao definitiva — some das listas
--     em todos os surfaces (procedimentos, atendimentos, convenios,
--     planos de tratamento). Pode ser revertido tecnicamente via DB.

ALTER TABLE public.procedures
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

ALTER TABLE public.procedures
  ADD COLUMN IF NOT EXISTS deleted_by UUID NULL;

-- Recria o unique parcial pra excluir soft-deleted. Sem isso, deletar
-- um procedimento listado bloquearia recadastro com o mesmo tuss_code.
DROP INDEX IF EXISTS public.procedures_tenant_tuss_listed_unique;
CREATE UNIQUE INDEX IF NOT EXISTS procedures_tenant_tuss_listed_unique
  ON public.procedures (tenant_id, tuss_code)
  WHERE NOT is_unlisted AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS procedures_tenant_active_idx
  ON public.procedures (tenant_id)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN public.procedures.deleted_at IS
  'Soft delete. NULL = ativo na listagem. NOT NULL remove de todas as selecoes (atendimentos, convenios, planos), mas preserva FK historicas.';

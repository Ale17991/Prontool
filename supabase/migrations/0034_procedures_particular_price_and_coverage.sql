-- T-procedures-coverage: cada procedimento passa a ter um valor "particular"
-- (raiz — aplicado quando paciente não tem plano ou quando o procedimento
-- não é coberto por plano) e um flag de cobertura. O flag default TRUE
-- preserva o comportamento de procedimentos legados.

ALTER TABLE public.procedures
  ADD COLUMN IF NOT EXISTS default_amount_cents BIGINT
    CHECK (default_amount_cents IS NULL OR default_amount_cents >= 0);

ALTER TABLE public.procedures
  ADD COLUMN IF NOT EXISTS covered_by_plan BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS procedures_coverage_idx
  ON public.procedures (tenant_id, covered_by_plan)
  WHERE covered_by_plan = TRUE;

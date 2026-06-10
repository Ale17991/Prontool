-- 0120 — Feature 032/034: metas por paciente e por métrica (Dash de Metas).
--
-- A equipe define um ALVO por métrica do paciente (peso, glicemia, HbA1c,
-- colesterol, circunferência, % gordura...). O portal mostra valor atual × alvo
-- + barra de progresso + tendência + ✓ ao atingir.
--
-- `metric_type` é TEXT LIVRE (não FK) de propósito: aceita as chaves do catálogo
-- (`patient_metric_types`: glicemia_jejum, hba1c, ...) E também 'peso_kg'/'imc'
-- que vêm de `vital_signs` (não estão no catálogo).
--
-- Uma meta ATIVA por (tenant, paciente, métrica) — índice parcial único.
-- RLS: leitura same-tenant; escrita admin/profissional_saude. Append? Não —
-- meta é editável (deactivate + nova), então UPDATE de `active`/`target` é ok.
--
-- Constituição: III multi-tenant (RLS jwt_tenant_id); V RBAC (escrita clínica).
-- Reversibilidade: aditiva, idempotente.

CREATE TABLE IF NOT EXISTS public.patient_metric_goals (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  patient_id         UUID        NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  metric_type        TEXT        NOT NULL CHECK (metric_type ~ '^[a-z][a-z0-9_]{1,63}$'),
  direction          TEXT        NOT NULL CHECK (direction IN ('decrease', 'increase')),
  target_value       NUMERIC     NOT NULL,
  active             BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id UUID        NOT NULL REFERENCES auth.users(id)
);

-- Uma meta ativa por métrica do paciente.
CREATE UNIQUE INDEX IF NOT EXISTS patient_metric_goals_one_active
  ON public.patient_metric_goals (tenant_id, patient_id, metric_type) WHERE active;

CREATE INDEX IF NOT EXISTS patient_metric_goals_patient_idx
  ON public.patient_metric_goals (tenant_id, patient_id) WHERE active;

DROP TRIGGER IF EXISTS patient_metric_goals_touch_updated_at ON public.patient_metric_goals;
CREATE TRIGGER patient_metric_goals_touch_updated_at
  BEFORE UPDATE ON public.patient_metric_goals
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMENT ON TABLE public.patient_metric_goals IS
  'Feature 032/034 — alvo por paciente×métrica (Dash de Metas do portal). metric_type livre: catálogo (glicemia_jejum...) + peso_kg/imc (de vital_signs).';

ALTER TABLE public.patient_metric_goals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS patient_metric_goals_read ON public.patient_metric_goals;
CREATE POLICY patient_metric_goals_read ON public.patient_metric_goals
  FOR SELECT TO authenticated
  USING (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS patient_metric_goals_clinico_write ON public.patient_metric_goals;
CREATE POLICY patient_metric_goals_clinico_write ON public.patient_metric_goals
  FOR ALL TO authenticated
  USING (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN ('admin', 'profissional_saude'))
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN ('admin', 'profissional_saude'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.patient_metric_goals TO authenticated;

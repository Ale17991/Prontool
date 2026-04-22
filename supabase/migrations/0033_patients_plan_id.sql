-- T-patients-plan: paciente passa a ter um plano de saúde default.
-- Nullable no banco para não quebrar registros legados e permitir pacientes
-- "sem plano" ainda; a UI exige no cadastro manual. upsertPatientFromGhl
-- tenta mapear um custom field de plano do GHL para o plan_id local por
-- nome; se não encontrar, salva NULL + dispara alerta operacional.

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS plan_id UUID
    REFERENCES public.health_plans(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS patients_plan_idx
  ON public.patients (tenant_id, plan_id)
  WHERE plan_id IS NOT NULL;

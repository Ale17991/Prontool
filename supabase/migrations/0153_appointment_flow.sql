-- 0153 — Fluxo operacional do atendimento (recepção) + chegada/permanência.
--
-- Camada OPERACIONAL separada do status financeiro (appointments_effective:
-- realizado/estornado/cancelado permanece intocado). A recepção atualiza este
-- status manualmente na agenda para controlar a sala de espera:
--   agendado -> aguardando -> em_consulta -> atendido | desmarcou
-- Os timestamps registram chegada e permanência do paciente na clínica:
--   arrived_at         — quando entrou em "aguardando" (chegou)
--   consult_started_at — quando entrou em "em_consulta"
--   ended_at           — quando "atendido" ou "desmarcou" (saída)
-- Tempo de espera = (consult_started_at | ended_at | now) - arrived_at
-- Permanência     = (ended_at | now) - arrived_at
-- Estado MUTÁVEL (1 linha por atendimento); o histórico de transições fica no
-- audit_log (gravado pelo core). NÃO toca a view appointments_effective. Aditiva
-- e idempotente.

CREATE TABLE IF NOT EXISTS public.appointment_flow (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  appointment_id     UUID NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  status             TEXT NOT NULL DEFAULT 'agendado'
                       CHECK (status IN ('agendado', 'aguardando', 'em_consulta', 'atendido', 'desmarcou')),
  arrived_at         TIMESTAMPTZ,
  consult_started_at TIMESTAMPTZ,
  ended_at           TIMESTAMPTZ,
  updated_by         UUID REFERENCES auth.users(id),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT appointment_flow_unique UNIQUE (tenant_id, appointment_id)
);

CREATE INDEX IF NOT EXISTS appointment_flow_tenant_idx
  ON public.appointment_flow (tenant_id, appointment_id);

ALTER TABLE public.appointment_flow ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS appointment_flow_read ON public.appointment_flow;
CREATE POLICY appointment_flow_read ON public.appointment_flow
  FOR SELECT
  USING (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS appointment_flow_write ON public.appointment_flow;
CREATE POLICY appointment_flow_write ON public.appointment_flow
  FOR ALL
  USING (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() IN ('admin', 'recepcionista', 'profissional_saude')
  )
  WITH CHECK (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() IN ('admin', 'recepcionista', 'profissional_saude')
  );

COMMENT ON TABLE public.appointment_flow IS
  'Fluxo operacional do atendimento (recepção) + chegada/permanência. Separado do status financeiro; não toca appointments_effective.';

NOTIFY pgrst, 'reload schema';

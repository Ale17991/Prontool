-- 0139 — Marcar atendimento como RETORNO (backlog 1/6).
--
-- Flag por atendimento: consulta de retorno (follow-up). Default false.
-- A view appointments_effective é SELECT a.* — herda a coluna automaticamente.
--
-- Numerada 0139 (0138 reservado p/ a migration de orçamento/odonto do outro
-- agente). Aditiva e idempotente.

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS is_return BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.appointments.is_return IS
  'Backlog 1/6 — atendimento marcado como retorno (consulta de acompanhamento).';

NOTIFY pgrst, 'reload schema';

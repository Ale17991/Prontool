-- 0191 — Acompanhamento de crescimento como opção do paciente.
--
-- A curva pediátrica aparecia sozinha sempre que havia nascimento, sexo e
-- aferição. Isso está errado por dois motivos: numa clínica de adultos ela
-- surgiria em qualquer paciente jovem que tenha peso registrado, e a decisão de
-- ACOMPANHAR crescimento é clínica — pertence à profissional, não a uma
-- heurística de "tem dado suficiente".
--
-- Coluna nullable com default FALSE, no precedente das outras flags de paciente
-- (`reminders_opt_in`, `reminders_whatsapp_opt_in`). Sem tabela nova: é um
-- atributo do paciente, não uma entidade.

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS growth_tracking_enabled BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.patients.growth_tracking_enabled IS
  'Exibe as curvas de crescimento (percentis OMS) na ficha. Ligado pela equipe.';

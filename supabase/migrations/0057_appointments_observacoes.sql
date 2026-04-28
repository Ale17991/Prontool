-- 0057 — Acrescenta coluna `observacoes TEXT NULL` em appointments para
-- anotacoes clinicas no momento da criacao do atendimento.
--
-- Decisoes:
--   1. NULLABLE — atendimentos pre-feature ficam NULL.
--   2. Sem CHECK de tamanho aqui (validacao na API via Zod max 500).
--   3. Imutavel apos INSERT pelo trigger appointments_enforce_append_only
--      ja em vigor (0012). Edicao posterior exige fluxo proprio (fora deste
--      escopo).
--   4. Nao toca em treatment_plan_steps.notes — ja existia separadamente.

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS observacoes TEXT NULL;

COMMENT ON COLUMN public.appointments.observacoes IS
  'Anotacoes clinicas livres preenchidas no momento do registro do atendimento. Imutavel apos INSERT (Principio I).';

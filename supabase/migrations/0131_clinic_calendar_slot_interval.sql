-- 0131 — Intervalo de slot da agenda configurável por clínica.
--
-- Cada linha do calendário (dia/semana) representava sempre 1 hora. Esta coluna
-- permite a clínica escolher o período que cada linha representa (em minutos):
-- a linha mantém a mesma altura visual, mas passa a cobrir o intervalo
-- configurado (ex.: 30 = meia hora, 15 = quinze minutos). Default 60 preserva
-- exatamente o comportamento atual.
--
-- Aditiva e idempotente.

ALTER TABLE public.tenant_clinic_profile
  ADD COLUMN IF NOT EXISTS calendar_slot_interval_minutes INTEGER NOT NULL DEFAULT 60
    CHECK (calendar_slot_interval_minutes BETWEEN 5 AND 240);

COMMENT ON COLUMN public.tenant_clinic_profile.calendar_slot_interval_minutes IS
  'Feature: período (minutos) que cada linha da agenda representa. Default 60.';

NOTIFY pgrst, 'reload schema';

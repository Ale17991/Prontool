-- 0132 — Relaxa o limite de calendar_slot_interval_minutes.
--
-- A 0131 limitava o intervalo a 5–240 min. A clínica precisa digitar qualquer
-- valor (e escolher minutos ou horas na UI). Ampliamos para 1–1440 (até 1 dia).
-- Self-contained: garante a coluna (caso a 0131 não tenha sido aplicada) e
-- substitui a CHECK pela versão ampla. Idempotente.

ALTER TABLE public.tenant_clinic_profile
  ADD COLUMN IF NOT EXISTS calendar_slot_interval_minutes INTEGER NOT NULL DEFAULT 60;

ALTER TABLE public.tenant_clinic_profile
  DROP CONSTRAINT IF EXISTS tenant_clinic_profile_calendar_slot_interval_minutes_check;

ALTER TABLE public.tenant_clinic_profile
  ADD CONSTRAINT tenant_clinic_profile_calendar_slot_interval_minutes_check
    CHECK (calendar_slot_interval_minutes BETWEEN 1 AND 1440);

NOTIFY pgrst, 'reload schema';

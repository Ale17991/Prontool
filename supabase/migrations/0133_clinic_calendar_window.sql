-- 0133 — Horário de funcionamento da clínica (janela do calendário).
--
-- O calendário (dia/semana) era fixo em 07:00–22:00. Estas colunas deixam a
-- clínica definir abertura e fechamento; o calendário passa a renderizar só
-- essa janela. Default 07:00–22:00 preserva o comportamento atual.
--
-- Aditiva e idempotente.

ALTER TABLE public.tenant_clinic_profile
  ADD COLUMN IF NOT EXISTS calendar_open_time  TIME NOT NULL DEFAULT '07:00',
  ADD COLUMN IF NOT EXISTS calendar_close_time TIME NOT NULL DEFAULT '22:00';

ALTER TABLE public.tenant_clinic_profile
  DROP CONSTRAINT IF EXISTS tenant_clinic_profile_calendar_window_check;

ALTER TABLE public.tenant_clinic_profile
  ADD CONSTRAINT tenant_clinic_profile_calendar_window_check
    CHECK (calendar_open_time < calendar_close_time);

COMMENT ON COLUMN public.tenant_clinic_profile.calendar_open_time IS
  'Horário de abertura da clínica — início da janela do calendário.';
COMMENT ON COLUMN public.tenant_clinic_profile.calendar_close_time IS
  'Horário de fechamento da clínica — fim (exclusivo) da janela do calendário.';

NOTIFY pgrst, 'reload schema';

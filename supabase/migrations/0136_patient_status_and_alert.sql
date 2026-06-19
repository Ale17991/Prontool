-- 0136 — Status do paciente (óbito/inativo) + aviso por paciente (backlog 1/5 + 1/11).
--
-- status: bloqueia novas marcações e mensagens automáticas quando != 'ativo'
--   (óbito ou inativo). Default 'ativo' preserva o comportamento atual.
-- alert_note: aviso livre por paciente, exibido como pop-up ao abrir a ficha.
--
-- Colunas não-PII (operacionais), no padrão de plan_id. Aditiva e idempotente.

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ativo'
    CHECK (status IN ('ativo', 'inativo', 'obito')),
  ADD COLUMN IF NOT EXISTS alert_note TEXT NULL;

COMMENT ON COLUMN public.patients.status IS
  'Backlog 1/5 — ativo | inativo | obito. !=ativo bloqueia agendamento e mensagens.';
COMMENT ON COLUMN public.patients.alert_note IS
  'Backlog 1/11 — aviso por paciente exibido ao abrir a ficha (pop-up bloqueante).';

NOTIFY pgrst, 'reload schema';

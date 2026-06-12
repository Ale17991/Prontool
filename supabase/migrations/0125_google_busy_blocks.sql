-- 0125 — Entrada do Google Calendar: compromissos do médico viram BLOQUEIO na
-- agenda (sem detalhe — só o horário ocupado). Reusa `schedule_blocks` (0083).
--
--   1. schedule_blocks.source — distingue 'manual' (criado na clínica) de
--      'google' (espelho dos horários ocupados da agenda pessoal do médico).
--      Os blocos 'google' são gerenciados pelo sync (soft-delete + re-insert).
--   2. user_integrations.busy_synced_at — TTL do cache do sync sob demanda
--      (evita chamar o Google a cada abertura de agenda).
--
-- ALTER idempotente.

ALTER TABLE public.schedule_blocks
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';

-- Restringe valores conhecidos (idempotente).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'schedule_blocks_source_chk'
  ) THEN
    ALTER TABLE public.schedule_blocks
      ADD CONSTRAINT schedule_blocks_source_chk CHECK (source IN ('manual', 'google'));
  END IF;
END $$;

COMMENT ON COLUMN public.schedule_blocks.source IS
  'manual = bloqueio criado na clínica; google = espelho de horário ocupado da agenda Google do médico (gerenciado pelo sync).';

-- Acelera o refresh do sync (apaga/recria os blocos google ativos do médico).
CREATE INDEX IF NOT EXISTS schedule_blocks_google_active_idx
  ON public.schedule_blocks (tenant_id, doctor_id, block_date)
  WHERE source = 'google' AND deleted_at IS NULL;

ALTER TABLE public.user_integrations
  ADD COLUMN IF NOT EXISTS busy_synced_at TIMESTAMPTZ;

COMMENT ON COLUMN public.user_integrations.busy_synced_at IS
  'Último sync sob demanda dos horários ocupados (FreeBusy) → schedule_blocks. TTL do cache.';

NOTIFY pgrst, 'reload schema';

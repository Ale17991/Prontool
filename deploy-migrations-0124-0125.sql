-- Deploy Google Calendar: migrations 0124-0125 — agenda pessoal do profissional
-- Gerado em 2026-08-14.
--
-- COMO RODAR: cole INTEIRO no SQL Editor do Supabase de produção e execute uma
-- vez só. Está tudo dentro de uma transação: se qualquer passo falhar, nada é
-- aplicado e o banco fica exatamente como estava.
--
-- A ORDEM IMPORTA e o arquivo já a respeita: a 0125 acrescenta uma coluna em
-- user_integrations, que só existe depois da 0124.
--
-- IDEMPOTENTE: rodar duas vezes não quebra nem duplica nada (IF NOT EXISTS em
-- tabelas, colunas e índices; DROP ... IF EXISTS antes da policy; a constraint
-- de CHECK é criada dentro de um guard que consulta pg_constraint). Se estas
-- duas já tiverem sido aplicadas em algum deploy anterior, rodar de novo é
-- inofensivo — é justamente por isso que vale rodar em vez de investigar.
--
-- O QUE MUDA EM TABELA QUE JÁ TEM DADO:
--   * schedule_blocks — ganha source TEXT NOT NULL DEFAULT 'manual'.
--       Todo bloqueio existente vira 'manual', que é o que ele de fato é: foi
--       criado por alguém da clínica. 'google' é reservado para o espelho dos
--       horários ocupados da agenda pessoal do médico, gerenciado pelo sync.
--   * Nada mais é reescrito. As duas tabelas novas nascem vazias.
--
-- DEPOIS DE RODAR, o código AINDA fica inerte até existirem as três env vars
-- GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI na Vercel.
-- Sem elas, /configuracoes/google-agenda mostra "não configurado" — que é o
-- estado seguro, não um erro.

BEGIN;

-- =========================================================================
-- 0124 — Integrações POR USUÁRIO + sync de agendamentos com Google Calendar.
--
-- Diferente de `tenant_integrations` (por clínica), o Google Calendar é
-- conectado por PROFISSIONAL: o evento entra na agenda pessoal do médico do
-- atendimento. Por isso uma tabela nova chaveada por (user_id, tenant_id).
--
--   1. user_integrations — tokens OAuth cifrados por usuário×clínica×provider.
--      Mesma key simétrica (PATIENT_DATA_ENCRYPTION_KEY) e mesmo enc_text_with_key
--      de tenant_integrations. Escrita só por service_role (callback OAuth / sync).
--   2. appointment_calendar_sync — mapa appointment→evento externo, para
--      atualizar/cancelar (reagendamento = estorno do antigo + novo evento).
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.user_integrations (
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL CHECK (provider IN ('google_calendar')),
  config          JSONB NOT NULL DEFAULT '{}'::jsonb,
  credentials_enc BYTEA,
  status          TEXT NOT NULL DEFAULT 'connected'
                    CHECK (status IN ('connected', 'token_expired', 'disconnected')),
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  connected_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tenant_id, provider)
);

COMMENT ON TABLE public.user_integrations IS
  'Conexões externas POR USUÁRIO (ex.: Google Calendar do profissional). Tokens cifrados em credentials_enc. Escrita só service_role.';

ALTER TABLE public.user_integrations ENABLE ROW LEVEL SECURITY;

-- O próprio usuário lê o status da SUA conexão (para a UI de conectar/desconectar).
DROP POLICY IF EXISTS user_integrations_self_read ON public.user_integrations;
CREATE POLICY user_integrations_self_read ON public.user_integrations
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
-- intencional: sem policy de INSERT/UPDATE/DELETE para authenticated — só service_role.

CREATE INDEX IF NOT EXISTS user_integrations_tenant_idx
  ON public.user_integrations (tenant_id, provider);

CREATE TABLE IF NOT EXISTS public.appointment_calendar_sync (
  appointment_id    UUID NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  provider          TEXT NOT NULL CHECK (provider IN ('google_calendar')),
  tenant_id         UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  calendar_id       TEXT,
  external_event_id TEXT,
  status            TEXT NOT NULL DEFAULT 'synced'
                      CHECK (status IN ('synced', 'deleted', 'failed')),
  last_error        TEXT,
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (appointment_id, provider)
);

COMMENT ON TABLE public.appointment_calendar_sync IS
  'Mapa appointment→evento externo (Google Calendar) para permitir update/cancel. Escrita só service_role.';

ALTER TABLE public.appointment_calendar_sync ENABLE ROW LEVEL SECURITY;
-- intencional: sem policy para authenticated — leitura/escrita só por service_role.

CREATE INDEX IF NOT EXISTS appointment_calendar_sync_tenant_idx
  ON public.appointment_calendar_sync (tenant_id, provider);

-- =========================================================================
-- 0125 — Entrada do Google Calendar: compromissos do médico viram BLOQUEIO na
-- agenda (sem detalhe — só o horário ocupado). Reusa `schedule_blocks` (0083).
--
--   1. schedule_blocks.source — distingue 'manual' (criado na clínica) de
--      'google' (espelho dos horários ocupados da agenda pessoal do médico).
--      Os blocos 'google' são gerenciados pelo sync (soft-delete + re-insert).
--   2. user_integrations.busy_synced_at — TTL do cache do sync sob demanda
--      (evita chamar o Google a cada abertura de agenda).
-- =========================================================================

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

COMMIT;

NOTIFY pgrst, 'reload schema';

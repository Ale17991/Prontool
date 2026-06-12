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
--
-- CREATE idempotente.

-- =========================================================================
-- 1. user_integrations
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

-- =========================================================================
-- 2. appointment_calendar_sync — mapa appointment → evento externo
-- =========================================================================
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

NOTIFY pgrst, 'reload schema';

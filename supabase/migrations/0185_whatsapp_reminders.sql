-- =========================================================================
-- Feature 051 — Lembretes de consulta por WhatsApp
--
-- O envio passa por um serviço separado (repo Homio-CRM/clinni-whatsapp) que
-- fala com a Evolution API. Aqui guardamos: a conexão de cada clínica, a
-- evolução de entrega de cada mensagem, e a configuração de canal.
--
-- Decisões que esta migration materializa (ver specs/051-whatsapp-evolution):
--   D1  WhatsApp NÃO entra no registry de IntegrationAdapter — tabela dedicada,
--       mesmo desenho de tenant_memed_config (0110).
--   D4  A evolução de entrega vai em tabela PRÓPRIA e append-only. O trigger
--       enforce_reminders_status_transition (0094) só permite queued→terminal;
--       relaxá-lo para acomodar 'delivered'/'read' enfraqueceria uma garantia
--       de imutabilidade existente. Aqui ele é apenas ESTENDIDO com os 3
--       destinos novos de `queued →`, sem abrir transição a partir de terminal.
-- =========================================================================

-- =========================================================================
-- 1. tenant_whatsapp_config — conexão de WhatsApp por clínica (1 linha/tenant)
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.tenant_whatsapp_config (
  tenant_id           UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- api_key da clínica NO SERVIÇO de envio. Cifrada via
  -- enc_text_with_key(PATIENT_DATA_ENCRYPTION_KEY); nunca retornada ao browser.
  api_key_enc         BYTEA       NOT NULL,
  -- slug da clínica no serviço — prefixo do nome da instância ({slug}-{n}).
  service_tenant_slug TEXT        NOT NULL,
  instance_name       TEXT        NULL,
  connection_status   TEXT        NOT NULL DEFAULT 'disconnected'
                        CHECK (connection_status IN ('disconnected', 'connecting', 'connected')),
  -- FR-012a: distinguir "bloqueado pelo WhatsApp" de "apenas desconectado".
  -- NULL quando conectado. 'blocked' NUNCA desliga o canal automaticamente —
  -- só muda o aviso na tela; a decisão é da clínica.
  disconnect_reason   TEXT        NULL
                        CHECK (disconnect_reason IS NULL
                               OR disconnect_reason IN ('logged_out', 'blocked', 'unknown')),
  number_connected    TEXT        NULL,
  connected_at        TIMESTAMPTZ NULL,
  last_status_at      TIMESTAMPTZ NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id  UUID        NULL REFERENCES auth.users(id),
  PRIMARY KEY (tenant_id),
  CONSTRAINT whatsapp_slug_not_blank CHECK (length(btrim(service_tenant_slug)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_whatsapp_config_slug_key
  ON public.tenant_whatsapp_config (service_tenant_slug);

DROP TRIGGER IF EXISTS tenant_whatsapp_config_touch_updated_at ON public.tenant_whatsapp_config;
CREATE TRIGGER tenant_whatsapp_config_touch_updated_at
  BEFORE UPDATE ON public.tenant_whatsapp_config
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.tenant_whatsapp_config ENABLE ROW LEVEL SECURITY;

-- Leitura: qualquer usuário autenticado do tenant (a UI precisa saber se a
-- clínica tem WhatsApp conectado). api_key_enc nunca é projetada pelas rotas.
DROP POLICY IF EXISTS tenant_whatsapp_config_tenant_read ON public.tenant_whatsapp_config;
CREATE POLICY tenant_whatsapp_config_tenant_read ON public.tenant_whatsapp_config
  FOR SELECT
  USING (tenant_id = public.jwt_tenant_id());

-- Escrita: admin do tenant (FR-024). requireRole na rota é a 1ª camada.
DROP POLICY IF EXISTS tenant_whatsapp_config_admin_write ON public.tenant_whatsapp_config;
CREATE POLICY tenant_whatsapp_config_admin_write ON public.tenant_whatsapp_config
  FOR ALL
  USING  (tenant_id = public.jwt_tenant_id() AND public.jwt_role() = 'admin')
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() = 'admin');

COMMENT ON TABLE public.tenant_whatsapp_config IS
  'Feature 051 — conexão de WhatsApp por clínica (1 linha/tenant). api_key_enc cifrada via enc_text_with_key(PATIENT_DATA_ENCRYPTION_KEY), nunca retornada ao browser. disconnect_reason distingue bloqueio de queda comum (FR-012a).';

-- Auditoria (Princípio II): conexão, desconexão e mudança de estado.
CREATE OR REPLACE FUNCTION public.audit_tenant_whatsapp_config_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'tenant_whatsapp_config', NEW.tenant_id,
      'connection_status', NULL, NEW.connection_status,
      'whatsapp connection created'
    );
  ELSIF TG_OP = 'UPDATE' AND NEW.connection_status IS DISTINCT FROM OLD.connection_status THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'tenant_whatsapp_config', NEW.tenant_id,
      'connection_status', OLD.connection_status, NEW.connection_status,
      COALESCE('reason=' || NEW.disconnect_reason, 'transition')
    );
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.log_audit_event(
      OLD.tenant_id, 'tenant_whatsapp_config', OLD.tenant_id,
      'connection_status', OLD.connection_status, NULL,
      'whatsapp connection removed'
    );
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS audit_tenant_whatsapp_config ON public.tenant_whatsapp_config;
CREATE TRIGGER audit_tenant_whatsapp_config
  AFTER INSERT OR UPDATE OR DELETE ON public.tenant_whatsapp_config
  FOR EACH ROW EXECUTE FUNCTION public.audit_tenant_whatsapp_config_change();

-- =========================================================================
-- 2. whatsapp_delivery_events — evolução de entrega (append-only)
-- =========================================================================
-- Uma linha por confirmação recebida do serviço. A MESMA confirmação chegando
-- duas vezes gera duas linhas: é um log, e a leitura resolve por precedência
-- de rank (sent=1 < delivered=2 < read=3 < error=9), não por contagem. Isso
-- atende o FR-019 (status não regride) sem precisar reescrever registro.

CREATE TABLE IF NOT EXISTS public.whatsapp_delivery_events (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  reminder_id         UUID        NOT NULL REFERENCES public.appointment_reminders(id) ON DELETE RESTRICT,
  provider_message_id TEXT        NULL,
  status              TEXT        NOT NULL
                        CHECK (status IN ('sent', 'delivered', 'read', 'error')),
  error_detail        TEXT        NULL
                        CHECK (error_detail IS NULL OR length(error_detail) <= 500),
  -- Quando o evento ocorreu, segundo o serviço.
  occurred_at         TIMESTAMPTZ NOT NULL,
  -- Quando chegou aqui. Divergência grande entre os dois indica atraso na ponte.
  received_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_delivery_events_tenant_reminder_idx
  ON public.whatsapp_delivery_events (tenant_id, reminder_id);
CREATE INDEX IF NOT EXISTS whatsapp_delivery_events_reminder_occurred_idx
  ON public.whatsapp_delivery_events (reminder_id, occurred_at DESC);

ALTER TABLE public.whatsapp_delivery_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_delivery_events_tenant_read ON public.whatsapp_delivery_events;
CREATE POLICY whatsapp_delivery_events_tenant_read ON public.whatsapp_delivery_events
  FOR SELECT TO authenticated
  USING (tenant_id = public.jwt_tenant_id());

GRANT SELECT ON public.whatsapp_delivery_events TO authenticated;
GRANT SELECT, INSERT ON public.whatsapp_delivery_events TO service_role;

-- Append-only: sem UPDATE, sem DELETE.
CREATE OR REPLACE FUNCTION public.whatsapp_delivery_events_block_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING
    MESSAGE = format('%s not allowed on append-only table whatsapp_delivery_events', TG_OP),
    ERRCODE = '42501';
END $$;

DROP TRIGGER IF EXISTS whatsapp_delivery_events_no_mutation ON public.whatsapp_delivery_events;
CREATE TRIGGER whatsapp_delivery_events_no_mutation
  BEFORE UPDATE OR DELETE ON public.whatsapp_delivery_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.whatsapp_delivery_events_block_mutation();

COMMENT ON TABLE public.whatsapp_delivery_events IS
  'Feature 051 — append-only. Uma linha por confirmação de entrega vinda do serviço de WhatsApp. O status corrente de um lembrete é o de MAIOR rank (sent<delivered<read<error), nunca o mais recente: confirmação atrasada fica registrada mas não rebaixa (FR-019). Existe em tabela separada porque appointment_reminders é imutável após terminal.';

-- =========================================================================
-- 3. appointment_reminders — 3 status novos
-- =========================================================================
-- O CHECK de `channel` já aceita 'whatsapp' desde a 0094 — nada a fazer nele.

ALTER TABLE public.appointment_reminders
  DROP CONSTRAINT IF EXISTS appointment_reminders_status_check;

ALTER TABLE public.appointment_reminders
  ADD CONSTRAINT appointment_reminders_status_check CHECK (status IN (
    'queued', 'sent', 'failed',
    'skipped_opt_out', 'skipped_reversed', 'skipped_no_email', 'skipped_doctor_inactive',
    -- Feature 051
    'skipped_no_phone',        -- paciente sem telefone
    'skipped_no_connection',   -- número da clínica fora do ar no lote (FR-012)
    'skipped_opt_out_channel'  -- recusou ESTE canal, segue recebendo nos outros
  ));

-- Trigger de transição: aceita os 3 destinos novos a partir de `queued`.
-- Continua PROIBINDO qualquer transição a partir de estado terminal.
CREATE OR REPLACE FUNCTION public.enforce_reminders_status_transition()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Transição autorizada: queued → terminal
  IF OLD.status = 'queued' AND NEW.status IN (
    'sent', 'failed',
    'skipped_opt_out', 'skipped_reversed', 'skipped_no_email', 'skipped_doctor_inactive',
    'skipped_no_phone', 'skipped_no_connection', 'skipped_opt_out_channel'
  ) THEN
    RETURN NEW;
  END IF;
  -- Mesmo status (apenas atualizando error ou provider_message_id): ok
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING
    MESSAGE = format(
      'appointment_reminders status transition not allowed: %s → %s',
      OLD.status, NEW.status
    ),
    ERRCODE = '23514';
END $$;

-- =========================================================================
-- 4. patients — recusa específica do canal WhatsApp
-- =========================================================================
-- `reminders_opt_in` continua sendo o MESTRE: FALSE nele bloqueia todos os
-- canais. Este campo só é consultado quando o mestre é TRUE.

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS reminders_whatsapp_opt_in BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.patients.reminders_whatsapp_opt_in IS
  'Feature 051 — TRUE (default): paciente aceita lembrete por WhatsApp. FALSE: recusa APENAS este canal (status skipped_opt_out_channel); continua recebendo por e-mail. Subordinado a reminders_opt_in, que é o mestre.';

-- =========================================================================
-- 5. tenant_clinic_profile — escolha de canal
-- =========================================================================

ALTER TABLE public.tenant_clinic_profile
  ADD COLUMN IF NOT EXISTS reminder_channels TEXT[] NOT NULL DEFAULT ARRAY['email']::TEXT[];

ALTER TABLE public.tenant_clinic_profile
  ADD COLUMN IF NOT EXISTS reminder_whatsapp_fallback_email BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.tenant_clinic_profile
  ADD COLUMN IF NOT EXISTS reminder_template_whatsapp TEXT NULL;

ALTER TABLE public.tenant_clinic_profile
  DROP CONSTRAINT IF EXISTS reminder_channels_valid;
ALTER TABLE public.tenant_clinic_profile
  ADD CONSTRAINT reminder_channels_valid CHECK (
    array_length(reminder_channels, 1) >= 1
    AND reminder_channels <@ ARRAY['email', 'whatsapp']::TEXT[]
  );

COMMENT ON COLUMN public.tenant_clinic_profile.reminder_channels IS
  'Feature 051 — canais por onde o lembrete sai. Subconjunto não-vazio de {email, whatsapp}. Default {email} preserva o comportamento de quem já usava a 018.';
COMMENT ON COLUMN public.tenant_clinic_profile.reminder_whatsapp_fallback_email IS
  'Feature 051 — quando o canal é WhatsApp e o paciente não tem telefone, cai para e-mail em vez de não avisar ninguém.';
COMMENT ON COLUMN public.tenant_clinic_profile.reminder_template_whatsapp IS
  'Feature 051 — template TEXTO PURO do lembrete por WhatsApp. NULL = default do sistema. Não reusa reminder_template_body, que é HTML e chegaria com as tags literais no celular do paciente.';

-- =====================================================================
-- Feature 053 — Notificações por comportamento do paciente
--
-- Mensagem automática disparada por DADOS do paciente (checklist, medições,
-- acesso ao portal, ausência de retorno), não por agendamento.
--
-- Três tabelas novas e duas colunas. Nada aqui reusa `appointment_reminders`:
-- aquela tabela tem `appointment_id NOT NULL`, máquina de status fechada
-- (`enforce_reminders_status_transition`, 0094) e idempotência por
-- (appointment, offset, canal). Relaxar qualquer um dos três para acomodar
-- mensagem sem consulta enfraqueceria garantias que existiam antes desta
-- feature e nas quais a 051 já se apoiou.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. signal_rules — a instância de regra que a clínica ligou
--
-- A FAMÍLIA da regra (o que ela observa, quais parâmetros aceita, quais
-- placeholders oferece) é CÓDIGO, em src/lib/core/signals/catalog.ts — não
-- tem tabela. Mesmo tratamento dado aos números da IN 75/2020 na 052 e ao
-- catálogo de analitos na 050: definição de família é produto, não
-- configuração de clínica. Em TS ela fica revisável em PR, coberta por teste
-- e impossível de uma clínica corromper.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.signal_rules (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  family              TEXT NOT NULL,
  params              JSONB NOT NULL DEFAULT '{}'::jsonb,
  audience            TEXT NOT NULL DEFAULT 'todos_ativos',
  audience_doctor_id  UUID NULL REFERENCES public.doctors(id) ON DELETE SET NULL,
  channel             TEXT NOT NULL DEFAULT 'preferencial',
  message_template    TEXT NOT NULL,
  silence_days        SMALLINT NOT NULL,
  active              BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_user_id  UUID NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT signal_rules_family_valid CHECK (family IN (
    'meta_atingida', 'sequencia_habito', 'aniversario',
    'aniversario_acompanhamento', 'pos_consulta',
    'sem_acesso_portal', 'habito_sem_registro', 'sem_registrar_medicao',
    'recordatorio_em_branco', 'afastando_da_meta', 'exame_nao_realizado',
    'sem_retorno', 'avaliacao_vencida', 'plano_sem_revisao'
  )),
  CONSTRAINT signal_rules_audience_valid CHECK (audience IN ('todos_ativos', 'por_profissional')),
  CONSTRAINT signal_rules_channel_valid CHECK (channel IN ('whatsapp', 'email', 'preferencial')),
  CONSTRAINT signal_rules_silence_range CHECK (silence_days BETWEEN 1 AND 90),
  -- O profissional é obrigatório no público por profissional, e proibido fora
  -- dele. Sem isto, uma regra "todos os ativos" com doctor_id preenchido fica
  -- ambígua para sempre: ninguém sabe se o autor quis segmentar e errou o
  -- público, ou o contrário.
  CONSTRAINT signal_rules_audience_doctor_coherent CHECK (
    (audience = 'por_profissional' AND audience_doctor_id IS NOT NULL)
    OR (audience <> 'por_profissional' AND audience_doctor_id IS NULL)
  )
);

COMMENT ON TABLE public.signal_rules IS
  'Feature 053 — instância parametrizada de uma família do catálogo. A família em si é código (src/lib/core/signals/catalog.ts), não linha de tabela.';
COMMENT ON COLUMN public.signal_rules.params IS
  'Validado contra o paramsSchema (Zod) da família, na escrita e de novo na leitura pelo motor.';
COMMENT ON COLUMN public.signal_rules.active IS
  'Desativar mantém a linha: signal_occurrences referencia a regra, e apagar deixaria o histórico órfão.';

CREATE INDEX IF NOT EXISTS signal_rules_tenant_active_idx
  ON public.signal_rules (tenant_id, active) WHERE active;

DROP TRIGGER IF EXISTS signal_rules_touch_updated_at ON public.signal_rules;
CREATE TRIGGER signal_rules_touch_updated_at
  BEFORE UPDATE ON public.signal_rules
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.signal_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS signal_rules_tenant_read ON public.signal_rules;
CREATE POLICY signal_rules_tenant_read ON public.signal_rules
  FOR SELECT TO authenticated
  USING (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS signal_rules_admin_write ON public.signal_rules;
CREATE POLICY signal_rules_admin_write ON public.signal_rules
  FOR ALL TO authenticated
  USING (tenant_id = public.jwt_tenant_id() AND public.jwt_role() = 'admin')
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() = 'admin');

GRANT SELECT ON public.signal_rules TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.signal_rules TO service_role;

-- ---------------------------------------------------------------------
-- 2. signal_occurrences — o encontro entre regra e paciente num ciclo
--
-- Append-only. É o histórico E a fonte do anti-spam: silêncio por regra e teto
-- semanal são CONSULTAS sobre esta tabela, não contadores materializados.
-- Contador precisaria de reset, sofreria corrida entre ciclos e mentiria
-- quando alguém corrigisse uma ocorrência.
--
-- Os desfechos que NÃO enviaram são gravados igual aos que enviaram. Sem eles
-- é impossível responder "por que meu paciente não recebeu?", que é a primeira
-- pergunta que a clínica faz.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.signal_occurrences (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  rule_id     UUID NOT NULL REFERENCES public.signal_rules(id) ON DELETE RESTRICT,
  patient_id  UUID NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  -- Dia do ciclo NO FUSO DA CLÍNICA. "Dia" é conceito do usuário, não do
  -- servidor: um ciclo que roda 00:30 UTC é ainda ontem em São Paulo.
  cycle_date  DATE NOT NULL,
  outcome     TEXT NOT NULL,
  observed    JSONB NOT NULL DEFAULT '{}'::jsonb,
  message_id  UUID NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT signal_occurrences_outcome_valid CHECK (outcome IN (
    'enviada', 'silenciada', 'adiada', 'suprimida_sem_portal',
    'sem_consentimento', 'sem_contato', 'falha_envio'
  ))
);

COMMENT ON TABLE public.signal_occurrences IS
  'Feature 053 — append-only. Histórico e base do anti-spam. Grava TODOS os desfechos, inclusive os que não enviaram.';
COMMENT ON COLUMN public.signal_occurrences.cycle_date IS
  'Dia do ciclo no fuso da clínica, não em UTC.';

-- Idempotência do ciclo: reprocessar o mesmo dia não gera segunda ocorrência
-- nem segunda mensagem. Não é índice de performance — é a garantia FR-024.
CREATE UNIQUE INDEX IF NOT EXISTS signal_occurrences_cycle_unique
  ON public.signal_occurrences (rule_id, patient_id, cycle_date);

-- Consulta do silêncio por regra.
CREATE INDEX IF NOT EXISTS signal_occurrences_silence_idx
  ON public.signal_occurrences (tenant_id, rule_id, patient_id, created_at DESC);

-- Consulta do teto semanal (só envios contam).
CREATE INDEX IF NOT EXISTS signal_occurrences_cap_idx
  ON public.signal_occurrences (tenant_id, patient_id, created_at DESC)
  WHERE outcome = 'enviada';

ALTER TABLE public.signal_occurrences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS signal_occurrences_tenant_read ON public.signal_occurrences;
CREATE POLICY signal_occurrences_tenant_read ON public.signal_occurrences
  FOR SELECT TO authenticated
  USING (tenant_id = public.jwt_tenant_id());

GRANT SELECT ON public.signal_occurrences TO authenticated;
GRANT SELECT, INSERT ON public.signal_occurrences TO service_role;

-- ---------------------------------------------------------------------
-- 3. patient_messages — comunicação ao paciente, sem consulta
--
-- Deliberadamente NÃO conhece regra: é "mensagem enviada a um paciente", e
-- serve a esta feature e a quem vier depois (inclusive os lembretes, se um dia
-- migrarem para cá).
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.patient_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  patient_id    UUID NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  purpose       TEXT NOT NULL,
  channel       TEXT NOT NULL,
  -- O texto JÁ RENDERIZADO, como o paciente leu. O template pode ser editado
  -- depois; recompor a mensagem a partir dele mostraria à clínica algo
  -- diferente do que o paciente recebeu. É o oposto do rótulo da 052, que é
  -- recomposto de propósito — lá o documento ainda não foi entregue.
  body          TEXT NOT NULL,
  status        TEXT NOT NULL,
  error_detail  TEXT NULL,
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT patient_messages_purpose_valid CHECK (purpose IN ('acompanhamento')),
  CONSTRAINT patient_messages_channel_valid CHECK (channel IN ('whatsapp', 'email')),
  -- Sem 'delivered'/'read' em v1: whatsapp_delivery_events.reminder_id
  -- referencia appointment_reminders, então a confirmação de entrega não tem
  -- onde pousar para estas mensagens. Ampliar o CHECK depois é ALTER, não
  -- redesenho.
  CONSTRAINT patient_messages_status_valid CHECK (status IN ('sent', 'failed')),
  CONSTRAINT patient_messages_error_len CHECK (error_detail IS NULL OR length(error_detail) <= 500)
);

COMMENT ON TABLE public.patient_messages IS
  'Feature 053 — mensagem ao paciente SEM vínculo com consulta. O id é o externalId mandado ao serviço de envio (idempotência ponta a ponta).';
COMMENT ON COLUMN public.patient_messages.body IS
  'Texto já renderizado. Contém nome do paciente: tratar como dado de paciente (fora de log, fora de renderSafeDetail).';

CREATE INDEX IF NOT EXISTS patient_messages_tenant_patient_idx
  ON public.patient_messages (tenant_id, patient_id, sent_at DESC);

ALTER TABLE public.patient_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS patient_messages_tenant_read ON public.patient_messages;
CREATE POLICY patient_messages_tenant_read ON public.patient_messages
  FOR SELECT TO authenticated
  USING (tenant_id = public.jwt_tenant_id());

GRANT SELECT ON public.patient_messages TO authenticated;
GRANT SELECT, INSERT ON public.patient_messages TO service_role;

ALTER TABLE public.signal_occurrences
  ADD CONSTRAINT signal_occurrences_message_fk
  FOREIGN KEY (message_id) REFERENCES public.patient_messages(id) ON DELETE RESTRICT;

-- ---------------------------------------------------------------------
-- 4. Append-only: bloqueio de UPDATE e DELETE
--
-- Padrão de whatsapp_delivery_events (0185). A ocorrência NASCE no desfecho e
-- é imutável — diferente de appointment_reminders, que nasce `queued` e
-- transiciona. Lá a mensagem é enfileirada e o desfecho chega depois; aqui a
-- avaliação e a decisão acontecem no mesmo instante.
--
-- Quando o despacho assíncrono falha, NÃO se altera a ocorrência: grava-se
-- patient_messages.status='failed'. "Foi decidido enviar" e "a entrega falhou"
-- são fatos distintos e ambos verdadeiros.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.signals_block_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'A tabela % é append-only (feature 053)', TG_TABLE_NAME
    USING ERRCODE = '42501';
END $$;

DROP TRIGGER IF EXISTS signal_occurrences_no_mutation ON public.signal_occurrences;
CREATE TRIGGER signal_occurrences_no_mutation
  BEFORE UPDATE OR DELETE ON public.signal_occurrences
  FOR EACH ROW EXECUTE FUNCTION public.signals_block_mutation();

DROP TRIGGER IF EXISTS patient_messages_no_mutation ON public.patient_messages;
CREATE TRIGGER patient_messages_no_mutation
  BEFORE UPDATE OR DELETE ON public.patient_messages
  FOR EACH ROW EXECUTE FUNCTION public.signals_block_mutation();

-- ---------------------------------------------------------------------
-- 5. patients.outreach_opt_in — consentimento de FINALIDADE
--
-- DEFAULT FALSE é decisão, não descuido: a base existente nasce desligada
-- porque o aceite de lembrete de consulta foi dado para OUTRA finalidade.
-- Herdá-lo seria usar consentimento fora do propósito para o qual foi obtido.
--
-- O custo é real e conhecido: no primeiro dia a feature entrega zero mensagem
-- até a clínica recoletar aceite. A tela avisa isso antes de a clínica ligar a
-- primeira regra, para não parecer defeito.
-- ---------------------------------------------------------------------

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS outreach_opt_in BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.patients.outreach_opt_in IS
  'Feature 053 — aceite para mensagens de ACOMPANHAMENTO entre consultas. Finalidade distinta de reminders_opt_in (lembrete de consulta), que NÃO participa desta decisão. O gate de canal continua sendo reminders_whatsapp_opt_in: aquilo é preferência de canal, não de finalidade, e honrá-la aqui é a leitura conservadora.';

-- ---------------------------------------------------------------------
-- 6. tenant_clinic_profile.outreach_weekly_cap — o teto global
--
-- Mora no perfil da clínica, não em signal_rules: o paciente percebe o VOLUME
-- TOTAL que recebe, não a origem de cada mensagem. Teto por regra não somaria,
-- e quem largou o acompanhamento dispara várias regras ao mesmo tempo — é
-- justamente quem receberia demais.
--
-- A janela horária NÃO ganha colunas: reusa reminder_window_start/end.
-- ---------------------------------------------------------------------

ALTER TABLE public.tenant_clinic_profile
  ADD COLUMN IF NOT EXISTS outreach_weekly_cap SMALLINT NOT NULL DEFAULT 2;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenant_clinic_profile_outreach_cap_range'
  ) THEN
    ALTER TABLE public.tenant_clinic_profile
      ADD CONSTRAINT tenant_clinic_profile_outreach_cap_range
      CHECK (outreach_weekly_cap BETWEEN 1 AND 7);
  END IF;
END $$;

COMMENT ON COLUMN public.tenant_clinic_profile.outreach_weekly_cap IS
  'Feature 053 — teto de mensagens automáticas por paciente por semana, somando TODAS as regras.';

-- ---------------------------------------------------------------------
-- 7. Auditoria das regras (FR-007, Princípio II)
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.audit_signal_rule_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'signal_rules', NEW.id,
      'active', NULL, NEW.active::text,
      'regra criada: ' || NEW.family || ' ' || NEW.params::text
    );
  ELSIF TG_OP = 'UPDATE' THEN
    -- Registra a mudança de estado ligada/desligada, e o resto como motivo. É
    -- a alteração que muda o que o paciente recebe.
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'signal_rules', NEW.id,
      'active', OLD.active::text, NEW.active::text,
      'regra alterada: ' || NEW.family
        || ' params ' || OLD.params::text || ' -> ' || NEW.params::text
        || CASE WHEN OLD.message_template IS DISTINCT FROM NEW.message_template
                THEN ' (texto alterado)' ELSE '' END
    );
  ELSE
    PERFORM public.log_audit_event(
      OLD.tenant_id, 'signal_rules', OLD.id,
      'active', OLD.active::text, NULL,
      'regra removida: ' || OLD.family
    );
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS audit_signal_rules ON public.signal_rules;
CREATE TRIGGER audit_signal_rules
  AFTER INSERT OR UPDATE OR DELETE ON public.signal_rules
  FOR EACH ROW EXECUTE FUNCTION public.audit_signal_rule_change();

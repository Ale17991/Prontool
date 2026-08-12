-- Deploy 056: migrations 0196-0197 — Construtor de automações de mensagem
-- Gerado em 2026-08-12.
--
-- COMO RODAR: cole INTEIRO no SQL Editor do Supabase de produção e execute uma
-- vez só. Está tudo dentro de uma transação: se qualquer passo falhar, nada é
-- aplicado e o banco fica exatamente como estava.
--
-- A ORDEM IMPORTA e o arquivo já a respeita: a 0197 cria uma FK para
-- automation_occurrences, que só existe depois da 0196.
--
-- IDEMPOTENTE: rodar duas vezes não quebra nem duplica nada (IF NOT EXISTS em
-- tabelas e colunas, DROP ... IF EXISTS antes de cada policy, trigger e
-- constraint).
--
-- O QUE MUDA EM TABELA QUE JÁ TEM DADO:
--   * patients — ganha automations_opt_in BOOLEAN NOT NULL DEFAULT FALSE.
--       Default FALSE é deliberado: automação é conteúdo não solicitado, e
--       ligar a base retroativamente seria fabricar consentimento. NINGUÉM
--       recebe automação até a clínica ligar a chave paciente a paciente.
--   * tenant_clinic_profile — ganha os dois tetos (1 por paciente/dia, 50 por
--       ciclo). São eles que impedem a primeira automação numa base grande de
--       virar rajada.
--   * whatsapp_delivery_events — reminder_id deixa de ser NOT NULL e entra
--       automation_occurrence_id. As linhas existentes continuam válidas: o
--       CHECK exige exatamente UMA das duas referências, e todas elas têm
--       reminder_id preenchido.
--
-- NÃO HÁ DROP de tabela, coluna ou dado em lugar nenhum deste arquivo.

BEGIN;


-- ============================================================================
-- ============ 0196_message_automations.sql
-- ============================================================================

-- 0196 — Construtor de automações de mensagem (feature 056).
--
-- A clínica monta GATILHOS (fonte + parâmetros) e associa MENSAGENS de um
-- catálogo próprio. As duas pontas são independentes e reaproveitáveis: a mesma
-- mensagem serve vários gatilhos, e trocar a mensagem de um gatilho não recria
-- o gatilho.
--
-- QUATRO DECISÕES QUE O SCHEMA PRECISA HONRAR:
--
-- 1. **"Uma vez só" é propriedade do BANCO, não do código.** O
--    `UNIQUE (automation_id, patient_id, occurrence_key)` de
--    `automation_occurrences` é o coração da feature: reexecutar o ciclo colide
--    no índice em vez de depender de a consulta de antijoin estar certa toda
--    vez. Cada fonte define o que é sua chave — data para aniversário, id do
--    atendimento para confirmação, índice do período para checklist.
--
-- 2. **Não há CHECK enumerando as fontes de gatilho.** A lista vive no registro
--    em código (`src/lib/core/automations/sources/registry.ts`). Um CHECK aqui
--    obrigaria migration a cada fonte nova e transformaria o ponto de extensão
--    em ponto de atrito — e é justamente por esse ponto que o lembrete de
--    consulta será absorvido no futuro, sem tocar neste schema.
--
-- 3. **`patients.automations_opt_in` nasce FALSE, e isso é deliberado.** Os
--    opt-ins de lembrete nascem TRUE porque lembrete de consulta é comunicação
--    esperada de uma clínica onde a pessoa marcou hora. Automação não é: é
--    conteúdo não solicitado, finalidade distinta em LGPD, e ligar 700
--    pacientes retroativamente seria fabricar consentimento.
--
-- 4. **Consistência de tenant é TRIGGER, não CHECK.** CHECK não enxerga outra
--    tabela, e as FKs sozinhas deixariam uma automação juntar gatilho de uma
--    clínica com mensagem de outra.

-- ---------------------------------------------------------------------------
-- Catálogo de mensagens
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.message_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  body        TEXT NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 1000),
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Duas mensagens com o mesmo nome tornam a lista inútil para quem escolhe.
  UNIQUE (tenant_id, name)
);

-- ---------------------------------------------------------------------------
-- Gatilhos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.automation_triggers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  -- Chave da fonte no registro em código. SEM CHECK — ver decisão 2 no topo.
  source      TEXT NOT NULL CHECK (length(btrim(source)) BETWEEN 1 AND 60),
  params      JSONB NOT NULL DEFAULT '{}'::jsonb,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (tenant_id, name)
);

-- ---------------------------------------------------------------------------
-- A automação: o vínculo que a clínica liga e desliga
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.automations (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  trigger_id           UUID NOT NULL REFERENCES public.automation_triggers(id) ON DELETE CASCADE,
  -- RESTRICT, não CASCADE: excluir mensagem em uso deve ser RECUSADO com a
  -- lista de quem depende dela, não apagar automações em silêncio.
  message_template_id  UUID NOT NULL REFERENCES public.message_templates(id) ON DELETE RESTRICT,
  -- Nasce DESLIGADA. Ativar é ato consciente, depois de ver a prévia de quantos
  -- pacientes serão atingidos.
  active               BOOLEAN NOT NULL DEFAULT FALSE,
  activated_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- A mesma dupla duas vezes é engano, não intenção.
  UNIQUE (trigger_id, message_template_id)
);

-- ---------------------------------------------------------------------------
-- Ocorrências — o registro append-only
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.automation_occurrences (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  automation_id   UUID NOT NULL REFERENCES public.automations(id) ON DELETE CASCADE,
  patient_id      UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  -- O que "uma ocorrência" significa para aquela fonte. Ver decisão 1.
  occurrence_key  TEXT NOT NULL CHECK (length(btrim(occurrence_key)) BETWEEN 1 AND 60),
  outcome         TEXT NOT NULL CHECK (outcome IN (
                    'pendente',
                    'enviado',
                    'suprimido_teto_paciente',
                    'suprimido_teto_clinica',
                    'impedido_sem_consentimento',
                    'impedido_sem_telefone',
                    'impedido_variavel_ausente',
                    'impedido_sem_conexao',
                    'falhou'
                  )),
  reason          TEXT CHECK (reason IS NULL OR length(reason) <= 500),
  -- Correlação com o envio, quando houve. TEXT, não UUID: é o id que o SERVIÇO
  -- de mensagem devolve, e ele é opaco para nós. Hoje o serviço usa uuid, mas
  -- amarrar o tipo a isso quebra no dia em que ele mudar de formato — e quebra
  -- do jeito pior, porque o UPDATE falha em silêncio e a ocorrência fica
  -- eternamente `pendente`, o que faz o teto por paciente parar de enxergar
  -- envios e mandar mensagem repetida.
  provider_message_id TEXT CHECK (provider_message_id IS NULL OR length(provider_message_id) <= 200),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- O CORAÇÃO DA FEATURE.
  UNIQUE (automation_id, patient_id, occurrence_key)
);

CREATE INDEX IF NOT EXISTS idx_automation_occurrences_tenant_created
  ON public.automation_occurrences (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_occurrences_automation
  ON public.automation_occurrences (automation_id, created_at DESC);
-- Suporta o teto por paciente/dia sem varrer a tabela.
CREATE INDEX IF NOT EXISTS idx_automation_occurrences_patient_day
  ON public.automation_occurrences (tenant_id, patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_automations_tenant_active
  ON public.automations (tenant_id, active);

-- ---------------------------------------------------------------------------
-- Consistência de tenant (decisão 4)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.automations_enforce_same_tenant()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_trigger_tenant UUID;
  v_message_tenant UUID;
BEGIN
  SELECT tenant_id INTO v_trigger_tenant
    FROM public.automation_triggers WHERE id = NEW.trigger_id;
  SELECT tenant_id INTO v_message_tenant
    FROM public.message_templates WHERE id = NEW.message_template_id;

  IF v_trigger_tenant IS DISTINCT FROM NEW.tenant_id
     OR v_message_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION USING
      MESSAGE = 'automation must reference a trigger and a message from its own tenant',
      ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS automations_same_tenant ON public.automations;
CREATE TRIGGER automations_same_tenant
  BEFORE INSERT OR UPDATE ON public.automations
  FOR EACH ROW EXECUTE FUNCTION public.automations_enforce_same_tenant();

-- ---------------------------------------------------------------------------
-- Append-only das ocorrências, com DUAS exceções declaradas
-- ---------------------------------------------------------------------------
--
-- A tabela é append-only porque é ela que prova o que foi enviado, para quem e
-- por quê. As duas exceções são estreitas e existem por motivo concreto:
--
--   (a) UPDATE só a partir de `pendente`. A ocorrência é gravada ANTES da
--       tentativa de envio — se fosse gravada depois, um processo morto entre
--       mandar e registrar abriria janela para envio duplicado, e mensagem
--       duplicada é pior que mensagem não enviada. O desfecho real substitui o
--       `pendente` uma vez; a partir daí a linha é imutável.
--
--   (b) DELETE só de linha SUPRIMIDA por teto. Supressão não é desfecho final,
--       é "não coube neste ciclo" — sem poder remover, o paciente perderia a
--       mensagem para sempre por acaso de ordenação.
CREATE OR REPLACE FUNCTION public.automation_occurrences_block_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.outcome <> 'pendente' THEN
      RAISE EXCEPTION USING
        MESSAGE = format(
          'UPDATE not allowed on append-only table automation_occurrences (outcome already final: %s)',
          OLD.outcome),
        ERRCODE = '42501';
    END IF;
    -- Só o desfecho e seus acompanhantes podem mudar na transição.
    IF NEW.automation_id <> OLD.automation_id
       OR NEW.patient_id <> OLD.patient_id
       OR NEW.occurrence_key <> OLD.occurrence_key
       OR NEW.tenant_id <> OLD.tenant_id THEN
      RAISE EXCEPTION USING
        MESSAGE = 'only outcome, reason and reminder_id may change on automation_occurrences',
        ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.outcome IN ('suprimido_teto_paciente', 'suprimido_teto_clinica') THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION USING
      MESSAGE = format(
        'DELETE not allowed on append-only table automation_occurrences (outcome: %s)',
        OLD.outcome),
      ERRCODE = '42501';
  END IF;

  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS automation_occurrences_no_mutation ON public.automation_occurrences;
CREATE TRIGGER automation_occurrences_no_mutation
  BEFORE UPDATE OR DELETE ON public.automation_occurrences
  FOR EACH ROW EXECUTE FUNCTION public.automation_occurrences_block_mutation();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['message_templates', 'automation_triggers', 'automations'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_read ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_read ON public.%I FOR SELECT TO authenticated USING (tenant_id = public.jwt_tenant_id())',
      t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_write ON public.%I', t, t);
    -- Montar automação é ato administrativo (FR-022) — só `admin` escreve.
    EXECUTE format(
      'CREATE POLICY %I_write ON public.%I FOR ALL TO authenticated USING (tenant_id = public.jwt_tenant_id() AND public.jwt_role() = ''admin'') WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() = ''admin'')',
      t, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

-- Ocorrências: a clínica LÊ, quem escreve é o motor (service_role).
ALTER TABLE public.automation_occurrences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS automation_occurrences_read ON public.automation_occurrences;
CREATE POLICY automation_occurrences_read ON public.automation_occurrences
  FOR SELECT TO authenticated
  USING (tenant_id = public.jwt_tenant_id());

GRANT SELECT ON public.automation_occurrences TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.automation_occurrences TO service_role;

-- ---------------------------------------------------------------------------
-- Consentimento próprio (decisão 3)
-- ---------------------------------------------------------------------------
ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS automations_opt_in BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.patients.automations_opt_in IS
  'Feature 056 — consentimento para mensagens de AUTOMAÇÃO, distinto do opt-in de lembrete de consulta (finalidades diferentes em LGPD). Hierárquico sob reminders_opt_in, que segue sendo o mestre e cala todos os canais. Default FALSE de propósito: automação é conteúdo não solicitado e o consentimento precisa ser coletado, não presumido.';

-- ---------------------------------------------------------------------------
-- Tetos de envio, por clínica
-- ---------------------------------------------------------------------------
ALTER TABLE public.tenant_clinic_profile
  ADD COLUMN IF NOT EXISTS automation_max_per_patient_day SMALLINT NOT NULL DEFAULT 1
    CHECK (automation_max_per_patient_day BETWEEN 0 AND 20),
  ADD COLUMN IF NOT EXISTS automation_max_per_cycle SMALLINT NOT NULL DEFAULT 50
    CHECK (automation_max_per_cycle BETWEEN 0 AND 500);

COMMENT ON COLUMN public.tenant_clinic_profile.automation_max_per_cycle IS
  'Feature 056 — teto de mensagens de automação por ciclo. Impede que ativar uma automação de estado contínuo (ex.: sem retorno há 6 meses) numa base grande vire disparo em massa no primeiro ciclo. O excedente sai nos ciclos seguintes.';

-- ---------------------------------------------------------------------------
COMMENT ON TABLE public.automation_occurrences IS
  'Feature 056 — append-only com duas exceções declaradas (transição de pendente para desfecho final; DELETE apenas de linha suprimida por teto, para reavaliação no ciclo seguinte). O UNIQUE (automation_id, patient_id, occurrence_key) é o que torna "uma vez só" propriedade do banco, e não disciplina de código.';


-- ============================================================================
-- ============ 0197_automation_delivery_events.sql
-- ============================================================================

-- 0197 — Confirmação de entrega também para mensagens de automação (056).
--
-- O PROBLEMA QUE ISTO CONSERTA
--
-- O FR-020 promete à clínica ver, por automação, quantas mensagens saíram e
-- quantas foram ENTREGUES e LIDAS. Hoje a segunda metade é impossível, e por um
-- motivo estrutural: `whatsapp_delivery_events.reminder_id` é NOT NULL com FK
-- para `appointment_reminders`. O motor de automações manda o id da OCORRÊNCIA
-- como `externalId`, o serviço devolve a confirmação com esse id, e a rota
-- `/api/webhooks/whatsapp-status` procura um lembrete com aquele id, não acha, e
-- responde `{ ok: true, ignored: 'unknown-reminder' }`.
--
-- O descarte é silencioso e devolve 200 — como tem que ser, senão o serviço
-- entraria em retentativa eterna. Mas o efeito é que TODA confirmação de
-- automação é jogada fora, e a clínica veria "enviado" para sempre, sem nunca
-- saber se a mensagem chegou.
--
-- A ESCOLHA: uma tabela, duas origens
--
-- A alternativa seria uma segunda tabela de eventos, espelhando esta. Ela foi
-- descartada porque a confirmação de entrega é o MESMO fato vindo do MESMO
-- serviço pela MESMA rota — o que muda é a que a mensagem se referia. Duas
-- tabelas obrigariam a duplicar o trigger append-only, a RLS, a precedência de
-- rank e a apuração de leitura; e no dia em que a regra de precedência mudasse,
-- mudaria em um lugar só, calado, e as duas leituras passariam a discordar.
--
-- O preço é que `reminder_id` deixa de ser NOT NULL. Ele é pago com o CHECK
-- abaixo: exatamente UMA das duas referências, nunca nenhuma e nunca as duas.
-- Uma linha órfã aqui seria pior que a coluna obrigatória.

ALTER TABLE public.whatsapp_delivery_events
  ALTER COLUMN reminder_id DROP NOT NULL;

ALTER TABLE public.whatsapp_delivery_events
  ADD COLUMN IF NOT EXISTS automation_occurrence_id UUID NULL
    REFERENCES public.automation_occurrences(id) ON DELETE RESTRICT;

-- RESTRICT, e NÃO CASCADE — e a diferença aqui não é de gosto, é de a feature
-- funcionar.
--
-- A `automation_occurrences` tem UMA exclusão legítima e prevista: a linha
-- suprimida por teto, que o motor apaga para o ciclo seguinte reavaliar o
-- paciente que ficou de fora. Com CASCADE, o PostgreSQL responde a essa
-- exclusão emitindo um `DELETE FROM whatsapp_delivery_events WHERE
-- automation_occurrence_id = $1` — e a `whatsapp_delivery_events` tem um
-- trigger append-only FOR EACH **STATEMENT** que levanta exceção
-- incondicionalmente. Trigger de statement dispara mesmo quando o DELETE não
-- casa linha nenhuma, então a exclusão da ocorrência falhava SEMPRE, inclusive
-- no caso normal em que não existe evento algum (suprimido por teto nunca foi
-- enviado).
--
-- O efeito era silencioso e grave: `releaseSuppressed` não relança, então a
-- linha suprimida continuava lá, o `UNIQUE (automação, paciente, chave)` seguia
-- ocupado, e o paciente que o teto segurou NUNCA receberia a mensagem — o teto
-- deixava de ser "fica para amanhã" e virava "perdeu para sempre".
--
-- Com RESTRICT a verificação de integridade é um SELECT, não um DELETE: não
-- fere o trigger, e a exclusão da ocorrência sem eventos passa. Se um evento
-- existir (ocorrência enviada), a exclusão é recusada — que é a resposta certa,
-- porque evidência de entrega não pode sumir junto.

ALTER TABLE public.whatsapp_delivery_events
  DROP CONSTRAINT IF EXISTS whatsapp_delivery_events_origem_check;

ALTER TABLE public.whatsapp_delivery_events
  ADD CONSTRAINT whatsapp_delivery_events_origem_check CHECK (
    (reminder_id IS NOT NULL AND automation_occurrence_id IS NULL)
    OR
    (reminder_id IS NULL AND automation_occurrence_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS whatsapp_delivery_events_occurrence_idx
  ON public.whatsapp_delivery_events (automation_occurrence_id, occurred_at DESC)
  WHERE automation_occurrence_id IS NOT NULL;

COMMENT ON COLUMN public.whatsapp_delivery_events.automation_occurrence_id IS
  'Feature 056 — a ocorrência de automação a que esta confirmação se refere. Exatamente uma de (reminder_id, automation_occurrence_id) é preenchida, pelo CHECK whatsapp_delivery_events_origem_check. Quem apura o SC-004 da 051 precisa filtrar reminder_id IS NOT NULL: a taxa de leitura de LEMBRETE não pode ser diluída por mensagem de automação, que é outra coisa e tem outra expectativa de leitura.';

NOTIFY pgrst, 'reload schema';


COMMIT;

-- ============ CONFERÊNCIA (rode DEPOIS, numa segunda execução) ============
-- Esperado: tabelas_056 = 4, consentimento = 1, tetos = 2,
--           entrega_automacao = 1, reminder_id_nullable = YES
--
-- SELECT
--   (SELECT count(*) FROM information_schema.tables
--      WHERE table_schema='public' AND table_name IN
--        ('message_templates','automation_triggers','automations','automation_occurrences')) AS tabelas_056,
--   (SELECT count(*) FROM information_schema.columns
--      WHERE table_name='patients' AND column_name='automations_opt_in') AS consentimento,
--   (SELECT count(*) FROM information_schema.columns
--      WHERE table_name='tenant_clinic_profile' AND column_name IN
--        ('automation_max_per_patient_day','automation_max_per_cycle')) AS tetos,
--   (SELECT count(*) FROM information_schema.columns
--      WHERE table_name='whatsapp_delivery_events' AND column_name='automation_occurrence_id') AS entrega_automacao,
--   (SELECT is_nullable FROM information_schema.columns
--      WHERE table_name='whatsapp_delivery_events' AND column_name='reminder_id') AS reminder_id_nullable;

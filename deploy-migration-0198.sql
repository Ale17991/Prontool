-- 0198 — A automação ganha nome próprio e horário de disparo (056).
--
-- TRÊS MUDANÇAS, UMA HISTÓRIA
--
-- A tela original pedia à clínica que criasse um GATILHO com nome, depois uma
-- MENSAGEM com nome, e só então ligasse os dois numa automação sem nome nenhum.
-- Eram três atos para uma ideia só, e o nome estava no objeto errado: o gatilho
-- é detalhe interno ("N dias antes da consulta, N=2"), enquanto a automação é o
-- que a clínica lembra, procura e desliga. Daí `automations.name`.
--
-- O gatilho continua existindo como linha própria — ele É a unidade de
-- enumeração do motor, e duas automações com o mesmo "quando" devem compartilhar
-- a mesma varredura. O que muda é que ele passa a ser criado por baixo, com nome
-- DERIVADO da fonte e dos parâmetros, e reaproveitado quando já existir um
-- idêntico. Por isso nenhuma coluna dele muda aqui.
--
-- `send_at_local` responde ao pedido de escolher a hora do envio. Ele é TIME sem
-- fuso de propósito: o que a clínica escolhe é a hora do RELÓGIO DELA ("mando às
-- 14:30"), e guardar isso como TIMESTAMPTZ obrigaria a fixar uma data para
-- ancorar o fuso — que muda no horário de verão e faria o envio andar uma hora
-- sozinho. O fuso vem de `tenant_clinic_profile.timezone`, no momento de decidir.
--
-- POR QUE PRECISA DE `last_fired_on` E `last_ran_at`, E POR QUE SÃO DOIS
--
-- O ciclo passou a rodar de 15 em 15 minutos (pg_cron no próprio Supabase —
-- ver `deploy-cron-15min.sql`). Uma automação de escala DIÁRIA não pode disparar
-- 96 vezes por dia só porque o ciclo acordou 96 vezes: `last_fired_on` guarda o
-- dia civil da clínica em que ela já rodou, e o motor a ignora no resto do dia.
--
-- `last_ran_at` serve a outra natureza: a automação ANCORADA num horário ("2
-- horas antes da consulta") precisa rodar em todo ciclo, e o que ela pergunta ao
-- banco é "que âncoras caíram na janela desde a última vez que olhei". Sem o
-- instante da última varredura, um deploy de 40 minutos abriria um buraco de
-- 40 minutos de consultas que ninguém avisou.
--
-- Nenhum dos dois é fonte de idempotência — essa continua sendo o
-- `UNIQUE (automation_id, patient_id, occurrence_key)` da 0196. São otimização e
-- janela; se ambos forem perdidos, o pior que acontece é varredura repetida, e o
-- banco recusa a segunda ocorrência.

ALTER TABLE public.automations
  ADD COLUMN IF NOT EXISTS name          TEXT,
  ADD COLUMN IF NOT EXISTS send_at_local TIME NOT NULL DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS last_fired_on DATE,
  ADD COLUMN IF NOT EXISTS last_ran_at   TIMESTAMPTZ;

-- As automações que existirem antes desta migration herdam o nome do gatilho.
-- É o rótulo que a clínica já via na lista ("gatilho → mensagem"), então nada
-- muda de nome debaixo de quem já montou alguma coisa.
UPDATE public.automations a
   SET name = t.name
  FROM public.automation_triggers t
 WHERE t.id = a.trigger_id
   AND a.name IS NULL;

-- Rede para o caso improvável de gatilho órfão (FK garante que não, mas
-- SET NOT NULL abaixo falharia de forma obscura se acontecesse).
UPDATE public.automations SET name = 'Automação' WHERE name IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'automations'
       AND column_name = 'name' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.automations ALTER COLUMN name SET NOT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'automations_name_len_check'
  ) THEN
    ALTER TABLE public.automations
      ADD CONSTRAINT automations_name_len_check
      CHECK (length(btrim(name)) BETWEEN 1 AND 80);
  END IF;
END $$;

-- Nome único por clínica, sem diferenciar caixa nem espaço nas pontas: duas
-- automações chamadas "Aniversário" e "aniversário " na mesma lista são um erro
-- de digitação, não duas coisas. A comparação normalizada evita que a clínica
-- crie a segunda sem perceber e depois desligue a errada.
CREATE UNIQUE INDEX IF NOT EXISTS automations_tenant_name_uq
  ON public.automations (tenant_id, lower(btrim(name)));

CREATE INDEX IF NOT EXISTS automations_due_idx
  ON public.automations (tenant_id, active, send_at_local)
  WHERE active;

COMMENT ON COLUMN public.automations.name IS
  'Feature 056 — o nome que a clínica dá à automação. É nela que o nome mora, e não no gatilho: o gatilho passou a ser criado por baixo, com nome derivado da fonte e dos parâmetros, e reaproveitado quando já existe um idêntico.';

COMMENT ON COLUMN public.automations.send_at_local IS
  'Feature 056 — hora do RELÓGIO DA CLÍNICA em que esta automação dispara. TIME sem fuso de propósito: o fuso vem de tenant_clinic_profile.timezone no momento de decidir, senão o horário de verão faria o envio andar uma hora sozinho. Ignorado quando os parâmetros da fonte são ancorados num horário ("2 horas antes da consulta"), porque aí o instante é o da âncora.';

COMMENT ON COLUMN public.automations.last_fired_on IS
  'Feature 056 — dia civil da clínica em que esta automação já disparou. O ciclo acorda a cada 15 minutos; sem isto, uma automação diária dispararia 96 vezes. NÃO é a idempotência da feature (essa é o UNIQUE (automation_id, patient_id, occurrence_key) da 0196) — se for perdido, o banco ainda recusa a ocorrência repetida.';

COMMENT ON COLUMN public.automations.last_ran_at IS
  'Feature 056 — instante da última varredura, usado só pelas automações ancoradas num horário. A janela do ciclo é (last_ran_at, agora]: sem ela, um deploy de 40 minutos abriria um buraco de 40 minutos de âncoras que ninguém avisou.';

NOTIFY pgrst, 'reload schema';

-- ===========================================================================
-- Ciclo de 5 em 5 minutos pelo próprio Supabase (features 018 / 051 / 056)
--
-- COLE ESTE ARQUIVO INTEIRO NO SQL EDITOR DO SUPABASE DE PRODUÇÃO,
-- depois de preencher as DUAS variáveis do bloco CONFIGURAÇÃO abaixo.
--
-- ---------------------------------------------------------------------------
-- POR QUE ISTO EXISTE
--
-- O motor de lembretes (018) sempre foi escrito para acordar a cada 15 minutos:
-- `select-due.ts` procura consultas numa janela de 15 minutos em torno de
-- "agora + antecedência". Rodando uma vez por dia, ele só acerta o lembrete cuja
-- consulta cai justamente naqueles 15 minutos — o resto passa batido, em
-- silêncio, sem erro nenhum no log.
--
-- Ele rodava uma vez por dia porque o cron da Vercel no plano Hobby não aceita
-- nada mais frequente que diário: passar disso não dá erro de configuração, dá
-- FALHA DE DEPLOY em todos os deploys do projeto. Foi assim que se descobriu o
-- limite, da pior maneira.
--
-- O `pg_cron` roda dentro do Postgres do Supabase e não conhece esse limite. O
-- `pg_net` dispara a chamada HTTP para a rota do ciclo, com o mesmo
-- `CRON_SECRET` que a Vercel já manda. Nada muda na aplicação.
--
-- SÃO 5 MINUTOS, E NÃO 15, POR CAUSA DAS AUTOMAÇÕES
--
-- Para o lembrete de consulta, 15 minutos bastariam — é o tamanho da janela de
-- `select-due.ts`. Quem pede 5 é a feature 056: o teto de envio por ciclo é de
-- UMA mensagem por clínica, então a cadência do cron é literalmente a distância
-- entre duas mensagens. É assim que vinte aniversariantes saem espalhados por
-- quase duas horas em vez de em vinte segundos, que é o padrão que faz um número
-- não-oficial ser bloqueado.
--
-- O cron diário da Vercel (`vercel.json`) FICA NO LUGAR de propósito: são dois
-- despertadores independentes para o mesmo endpoint. Se o pg_cron for desligado
-- por engano, o ciclo ainda acontece uma vez por dia em vez de nunca — e o ciclo
-- é idempotente (as ocorrências têm UNIQUE, os lembretes também), então rodar
-- duas vezes não manda mensagem duas vezes.
--
-- ---------------------------------------------------------------------------
-- CONFIGURAÇÃO — preencha estas duas linhas
-- ===========================================================================

-- 1) A URL pública do app (sem barra no fim). Ex.: https://app.clinnipro.com.br
-- 2) O MESMO valor de CRON_SECRET que está nas variáveis de ambiente da Vercel.

DO $configuracao$
DECLARE
  v_app_url TEXT := 'https://app.clinnipro.com.br';
  v_cron_secret TEXT := 'COLE_AQUI_O_CRON_SECRET_DA_VERCEL';
BEGIN
  IF v_cron_secret = 'COLE_AQUI_O_CRON_SECRET_DA_VERCEL' THEN
    RAISE EXCEPTION 'Preencha v_cron_secret com o CRON_SECRET da Vercel antes de rodar este script.';
  END IF;

  -- O segredo vai para o Vault, e não para dentro do comando do cron. O comando
  -- fica legível em `cron.job.command` para qualquer um com acesso ao banco; o
  -- Vault guarda cifrado e o comando só cita o NOME do segredo. Trocar o
  -- CRON_SECRET depois é reexecutar este bloco, sem mexer no agendamento.
  PERFORM 1 FROM vault.secrets WHERE name = 'clinni_cron_secret';
  IF FOUND THEN
    PERFORM vault.update_secret(
      (SELECT id FROM vault.secrets WHERE name = 'clinni_cron_secret'),
      v_cron_secret
    );
  ELSE
    PERFORM vault.create_secret(v_cron_secret, 'clinni_cron_secret',
      'CRON_SECRET da Vercel — autentica o ciclo de lembretes e automações');
  END IF;

  PERFORM 1 FROM vault.secrets WHERE name = 'clinni_app_url';
  IF FOUND THEN
    PERFORM vault.update_secret(
      (SELECT id FROM vault.secrets WHERE name = 'clinni_app_url'),
      v_app_url
    );
  ELSE
    PERFORM vault.create_secret(v_app_url, 'clinni_app_url',
      'URL pública do app — destino do ciclo disparado pelo pg_cron');
  END IF;
END
$configuracao$;

-- ===========================================================================
-- EXTENSÕES
--
-- Se qualquer um dos dois CREATE falhar por permissão, ligue as extensões pelo
-- painel (Database → Extensions), procurando por `pg_cron` e `pg_net`, e rode
-- este arquivo de novo. O resto do script não depende de tê-las criado aqui.
-- ===========================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ===========================================================================
-- A FUNÇÃO QUE O CRON CHAMA
--
-- Uma função, e não o `net.http_post` direto no comando do cron, por dois
-- motivos: o segredo é lido do Vault na hora da execução (trocar o segredo não
-- exige reagendar), e a chamada fica com um nome procurável quando alguém for
-- entender de onde vem o tráfego.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.clinni_run_cycle()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
-- `net` entra no caminho de busca junto de `public` e `extensions` porque o
-- schema em que o pg_net instala VARIA por projeto: neste ele caiu em `public`,
-- e a documentação da Supabase mostra `net.http_post`. Chamar sem qualificar e
-- deixar o search_path resolver funciona nos dois casos; qualificar com o schema
-- errado produz um cron que falha a cada 5 minutos sem ninguém perceber.
SET search_path = public, extensions, net, vault
AS $$
DECLARE
  v_url    TEXT;
  v_secret TEXT;
  v_req_id BIGINT;
BEGIN
  SELECT decrypted_secret INTO v_url
    FROM vault.decrypted_secrets WHERE name = 'clinni_app_url';
  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets WHERE name = 'clinni_cron_secret';

  IF v_url IS NULL OR v_secret IS NULL THEN
    RAISE EXCEPTION 'clinni_run_cycle: segredos ausentes no Vault (clinni_app_url / clinni_cron_secret)';
  END IF;

  -- `timeout_milliseconds` é o tempo que o pg_net espera pela RESPOSTA, não um
  -- limite para o trabalho do outro lado: a rota tem `maxDuration = 30` na
  -- Vercel e continua até o fim mesmo que a espera aqui termine antes. 30s
  -- deixa a resposta ser registrada em `net._http_response`, que é o que permite
  -- conferir depois se o ciclo respondeu 200.
  SELECT http_post(
    url := v_url || '/api/cron/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) INTO v_req_id;

  RETURN v_req_id;
END;
$$;

REVOKE ALL ON FUNCTION public.clinni_run_cycle() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.clinni_run_cycle() IS
  'Dispara o ciclo de lembretes (018/051) e automações (056) via pg_net. Agendada pelo pg_cron a cada 5 minutos — ver deploy-cron-5min.sql. O cron diário da Vercel continua existindo como rede de segurança.';

-- ===========================================================================
-- O AGENDAMENTO
-- ===========================================================================

DO $agendamento$
BEGIN
  -- `cron.unschedule` levanta exceção quando o job não existe, então a remoção
  -- é condicional. Sem isto, rodar este arquivo pela primeira vez falharia.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'clinni-cycle-5min') THEN
    PERFORM cron.unschedule('clinni-cycle-5min');
  END IF;

  -- O nome antigo, de quando o ciclo era de 15 minutos. Se ele chegou a ser
  -- agendado, precisa sair: dois agendamentos para o mesmo endpoint não
  -- duplicariam mensagem (o ciclo é idempotente), mas estragariam o
  -- ESPAÇAMENTO, que é justamente o que protege o número da clínica.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'clinni-cycle-15min') THEN
    PERFORM cron.unschedule('clinni-cycle-15min');
  END IF;

  PERFORM cron.schedule(
    'clinni-cycle-5min',
    '*/5 * * * *',
    $cmd$SELECT public.clinni_run_cycle();$cmd$
  );
END
$agendamento$;

-- ===========================================================================
-- CONFERÊNCIA — rode estas três consultas depois, separadamente
-- ===========================================================================

-- 1) O agendamento existe e está ativo?
--    SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'clinni-cycle-5min';

-- 2) As últimas execuções do cron (status 'succeeded' significa que a CHAMADA
--    saiu — não que o app respondeu 200; para isso, a consulta 3).
--    SELECT status, start_time, return_message
--      FROM cron.job_run_details
--     WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'clinni-cycle-5min')
--     ORDER BY start_time DESC LIMIT 10;

-- 3) O que o app respondeu. 200 é o ciclo tendo rodado; 401 é CRON_SECRET
--    errado; timeout costuma ser a URL errada. A tabela segue o mesmo schema da
--    extensão — neste projeto, `public`; em outros, `net`.
--    SELECT id, status_code, created, content
--      FROM public._http_response ORDER BY created DESC LIMIT 10;

-- Para desligar o ciclo frequente (o diário da Vercel continua):
--    SELECT cron.unschedule('clinni-cycle-5min');

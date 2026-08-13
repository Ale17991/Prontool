-- 0199 — O teto por ciclo vira o espaçamento entre mensagens (056).
--
-- O QUE MUDOU DE ENTENDIMENTO
--
-- `automation_max_per_cycle` nasceu como guarda-corpo de VOLUME: um número alto
-- (50) que só existia para impedir que ativar uma automação de estado contínuo
-- numa base grande virasse uma rajada de centenas de mensagens no primeiro
-- ciclo. Com o ciclo rodando uma vez por dia, 50 por ciclo eram 50 por dia.
--
-- O ciclo agora acontece a cada 5 minutos, e isso transforma o mesmo campo em
-- outra coisa: ele passou a ser a distância ENTRE DUAS MENSAGENS. Com o teto em
-- 1, a clínica manda no máximo uma mensagem de automação a cada 5 minutos; o
-- resto da fila fica para os ciclos seguintes, na mesma ordem.
--
-- Isso é o que protege o número. A Evolution/Baileys é solução não-oficial: o
-- que faz um número ser bloqueado é volume concentrado e mensagem repetida para
-- muita gente em pouco tempo — exatamente o formato de "vinte aniversariantes do
-- dia saindo em vinte segundos". Espalhados de 5 em 5 minutos, os mesmos vinte
-- levam pouco menos de duas horas, e o padrão deixa de parecer disparo em massa.
--
-- O teto de 50 deixado como estava seria pior que antes da mudança: 50 a cada 5
-- minutos são 14.400 mensagens por dia.
--
-- POR QUE SÓ O VALOR DE FÁBRICA É REESCRITO
--
-- O UPDATE abaixo alcança apenas quem está em 50, que é o default antigo e
-- significa "nunca configurou". Clínica que tiver escolhido outro número
-- escolheu conscientemente, e sobrescrever isso seria decidir por ela.

ALTER TABLE public.tenant_clinic_profile
  ALTER COLUMN automation_max_per_cycle SET DEFAULT 1;

UPDATE public.tenant_clinic_profile
   SET automation_max_per_cycle = 1
 WHERE automation_max_per_cycle = 50;

COMMENT ON COLUMN public.tenant_clinic_profile.automation_max_per_cycle IS
  'Feature 056 — quantas mensagens de automação esta clínica manda por CICLO. Com o ciclo a cada 5 minutos (deploy-cron-5min.sql), o valor 1 significa "uma mensagem a cada 5 minutos": é o espaçamento que protege o número contra bloqueio, e não um limite de volume diário. O excedente de cada ciclo não é gravado nem descartado — fica na fila e é reavaliado no ciclo seguinte, na mesma ordem. Subir este número encurta a fila e aumenta o risco de bloqueio, nessa ordem.';

NOTIFY pgrst, 'reload schema';

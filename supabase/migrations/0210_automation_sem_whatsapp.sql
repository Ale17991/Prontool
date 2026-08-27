-- 0210 — Número que não tem WhatsApp ganha desfecho próprio (056).
--
-- (Nasceu 0208 e foi renumerada: 0208 e 0209 chegaram por outra frente enquanto
-- esta era escrita. Terceira colisão do projeto — `ls supabase/migrations | tail`
-- ANTES de escolher o número, e de novo antes de commitar.)
--
-- O QUE A EVOLUTION ESTAVA DIZENDO, E O QUE NÓS ENTENDÍAMOS
--
-- Em 26/08/2026, às 18:00, uma mensagem de "Confirma 24hs antes" não saiu. O
-- serviço registrou a resposta crua da Evolution:
--
--     {"jid":"5516981552025@s.whatsapp.net","exists":false,"number":"5516981552025"}
--
-- O número está bem formado e tem o `55` — ele simplesmente NÃO TEM WhatsApp.
-- A Evolution respondeu 400, o braço traduziu para 502, e o motor classificou
-- como `falhou`, que desde a 0203 é RETENTÁVEL. Além disso o ciclo disparou o
-- alerta de falha de envio, que manda a clínica "conferir a conexão do número".
--
-- Três estragos, e nenhum é estético:
--
--   1. Retentar é inútil por construção. Numa automação ancorada, reenumerada a
--      cada ciclo por 30 minutos, isso queima até três vagas — e a vaga é UMA
--      por ciclo (0199), então insistir com um número inexistente CALA as
--      outras automações da clínica.
--   2. O alerta aponta para o lugar errado. A conexão está perfeita. Alerta que
--      manda caçar a coisa errada é o que ensina a clínica a ignorar alerta —
--      preocupação que o próprio código já registra em dois lugares.
--   3. Some um dado acionável. "O telefone deste paciente não tem WhatsApp" é
--      algo que a recepção resolve: confere o cadastro, liga. Virando "falha de
--      envio", morre como problema técnico nosso.
--
-- POR QUE UM DESFECHO NOVO, E NÃO `impedido_sem_telefone`
--
-- Porque o paciente TEM telefone. O que falta é WhatsApp naquele número, e a
-- ação da clínica é outra: em `sem_telefone` ela cadastra um número; aqui ela
-- confere o que já existe ou usa outro canal. Desfecho é o que a clínica lê no
-- histórico — dois problemas diferentes com o mesmo nome viram um problema que
-- ninguém resolve.
--
-- É `impedido_*`, e portanto FINAL: a 0207 abriu a retentativa só para
-- indisponibilidade passageira. Número que não existe no WhatsApp é estado do
-- mundo — exatamente a família que a 0203 descreveu e que continua fechada.

ALTER TABLE public.automation_occurrences
  DROP CONSTRAINT IF EXISTS automation_occurrences_outcome_check;

ALTER TABLE public.automation_occurrences
  ADD CONSTRAINT automation_occurrences_outcome_check CHECK (outcome IN (
    'pendente',
    'enviado',
    'suprimido_teto_paciente',
    'suprimido_teto_clinica',
    'impedido_sem_consentimento',
    'impedido_sem_telefone',
    'impedido_sem_whatsapp',
    'impedido_variavel_ausente',
    'impedido_sem_conexao',
    'falhou'
  ));

COMMENT ON COLUMN public.automation_occurrences.outcome IS
  'Feature 056 — o que aconteceu com esta ocorrência. `impedido_sem_whatsapp` (0208) é o número bem formado que a Evolution recusa com `exists:false`: o paciente tem telefone, o telefone não tem WhatsApp. Final de propósito — retentar é inútil por construção, e a vaga do ciclo é uma só. Distinto de `impedido_sem_telefone`, onde não há número nenhum: a ação da clínica é diferente em cada caso.';

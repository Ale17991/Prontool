-- 0200 — A automação passa a nascer LIGADA no paciente (056).
--
-- A INVERSÃO, E O QUE ELA CUSTA
--
-- A 0196 fez `automations_opt_in` nascer FALSE, e a razão está escrita lá: o
-- lembrete de consulta é sobre um compromisso que o paciente marcou, enquanto a
-- automação é conteúdo não solicitado, com finalidade distinta em LGPD — e ligar
-- a base inteira de uma vez seria fabricar um consentimento que ninguém deu.
--
-- A clínica decidiu o contrário, e a decisão é dela: a automação passa a nascer
-- LIGADA e a clínica desliga quando o paciente pedir. A base é ativada
-- retroativamente por este UPDATE — sem ele, a mudança de default valeria só
-- para quem se cadastrasse depois, e a clínica veria automação ligada sem
-- ninguém recebendo.
--
-- O apoio jurídico dessa escolha não é consentimento, é LEGÍTIMO INTERESSE
-- (LGPD art. 7º, IX): relação existente entre clínica e paciente, comunicação
-- pertinente ao cuidado. Esse apoio só se sustenta enquanto a recusa for fácil e
-- respeitada — o que o código garante em três pontos que continuam valendo:
--
--   1. `patients.reminders_opt_in` segue sendo o MESTRE. Quem recusou tudo
--      continua calado, e nada aqui reabre esse caso.
--   2. O botão de desligar está na ficha do paciente, e o motor relê o campo a
--      cada envio — não há cache de consentimento entre ciclos.
--   3. Paciente inativo ou anonimizado nunca é candidato, independente do campo.
--
-- O que muda de verdade no comportamento: `eligiblePatients` deixa de devolver
-- quase ninguém e passa a devolver a base. É por isso que esta migration só faz
-- sentido junto com o espaçamento da 0199 — ligar a base inteira sem a fila de
-- uma mensagem a cada 5 minutos seria a receita exata do bloqueio.

ALTER TABLE public.patients
  ALTER COLUMN automations_opt_in SET DEFAULT TRUE;

-- Anonimizado fica de fora de propósito. O campo dele não importa para o motor
-- (o filtro de elegibilidade já o exclui), mas escrever consentimento no
-- cadastro de quem exerceu o direito de sumir seria registrar uma vontade que
-- essa pessoa não manifestou.
UPDATE public.patients
   SET automations_opt_in = TRUE
 WHERE automations_opt_in = FALSE
   AND anonymized_at IS NULL;

COMMENT ON COLUMN public.patients.automations_opt_in IS
  'Feature 056 — este paciente aceita mensagens de automação (aniversário, acompanhamento, retorno). Nasce TRUE desde a 0200: a clínica desliga quando o paciente pedir, e não o contrário. O apoio é legítimo interesse, não consentimento — o que o torna defensável é a recusa ser fácil, imediata e definitiva. Continua subordinado a reminders_opt_in, que é o mestre e cala todos os canais.';

NOTIFY pgrst, 'reload schema';

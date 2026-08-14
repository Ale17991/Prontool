-- 0205 — Automação que já enviou não pode ser excluída (056).
--
-- (Nasceu 0204 e foi renumerada: aquele número ficou com a `0204_portal_brand.sql`,
-- de outra frente no mesmo checkout. Segunda colisão do dia — conferir
-- `ls supabase/migrations | tail` ANTES de escolher o número.)
--
-- O DEFEITO, DESCOBERTO TENTANDO
--
-- A 0196 fez `automation_occurrences.automation_id` cascatear na exclusão, e o
-- comentário de lá explica a intenção: excluir a automação levaria junto as
-- ocorrências, porque elas descrevem envios daquela dupla específica.
--
-- Só que a MESMA migration criou o trigger append-only, que recusa DELETE de
-- ocorrência cujo desfecho não seja supressão por teto. As duas regras foram
-- escritas no mesmo arquivo e nunca se encontraram: o CASCADE emite o DELETE, o
-- trigger levanta 42501, e a exclusão da automação falha inteira.
--
-- Na prática isso significava que o botão "Excluir automação" da tela funcionava
-- apenas para automação que NUNCA enviou nada — e ninguém tinha percebido
-- porque, até 14/08/2026, nenhuma automação em produção havia enviado.
--
-- A ESCOLHA: recusar em vez de destruir
--
-- Havia duas saídas. A primeira, tornar `automation_id` nulável e cascatear com
-- SET NULL, preservando a ocorrência órfã. Foi descartada: a ocorrência perderia
-- a qual automação pertenceu — que é metade da resposta para "por que esta
-- pessoa recebeu isto" — e o `UNIQUE (automation_id, patient_id,
-- occurrence_key)`, que é o que torna "uma vez só" propriedade do banco,
-- passaria a conviver com nulos.
--
-- A segunda, e a adotada: a exclusão é RECUSADA quando existe ocorrência, com um
-- erro que a aplicação sabe traduzir. O registro de que uma mensagem foi enviada
-- a um paciente é prova, e prova não some porque alguém arrumou a lista. A tela
-- oferece DESATIVAR, que é o que a clínica quer de verdade quando clica em
-- excluir: parar de enviar.
--
-- Automação que nunca enviou continua excluível — a ausência de ocorrência é
-- justamente o caso em que não há nada a preservar.

ALTER TABLE public.automation_occurrences
  DROP CONSTRAINT IF EXISTS automation_occurrences_automation_id_fkey;

ALTER TABLE public.automation_occurrences
  ADD CONSTRAINT automation_occurrences_automation_id_fkey
  FOREIGN KEY (automation_id) REFERENCES public.automations(id) ON DELETE RESTRICT;

COMMENT ON CONSTRAINT automation_occurrences_automation_id_fkey
  ON public.automation_occurrences IS
  'Feature 056 — RESTRICT, e não CASCADE: a ocorrência prova que uma mensagem foi enviada a um paciente, e essa prova não pode sumir porque alguém arrumou a lista de automações. Era CASCADE na 0196 e nunca funcionou — o DELETE cascateado esbarrava no trigger append-only e derrubava a exclusão inteira, com uma mensagem que falava de outra tabela. Automação que nunca enviou continua excluível.';

NOTIFY pgrst, 'reload schema';

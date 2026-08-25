-- 0207 — Queda de conexão volta a ser retentável (056).
--
-- (Última é a 0206. Conferido com `ls supabase/migrations | tail` antes de
-- escolher o número — duas colisões já custaram renumeração neste projeto.)
--
-- O QUE ACONTECEU, MEDIDO EM PRODUÇÃO
--
-- Em 21/08/2026, entre 15:20 e 16:40, o número da clínica caiu na Evolution.
-- Cinco pacientes com consulta marcada para umas quatro horas depois deviam
-- receber o aviso de "sua consulta é hoje". Nenhum recebeu, e nenhum vai
-- receber: as cinco ocorrências foram gravadas como `impedido_sem_conexao`, que
-- a 0203 deixou como desfecho FINAL, e o UNIQUE (automação, paciente, chave)
-- impede que outra seja criada no lugar.
--
-- A 0203 justificou assim a fronteira do que é retentável:
--
--     `impedido_*` continua final: sem consentimento, sem telefone e sem
--     variável são estados do mundo, não indisponibilidade.
--
-- A regra está certa e o enquadramento estava errado. Queda de conexão não é um
-- estado do mundo — é exatamente a indisponibilidade passageira que motivou a
-- própria 0203, quando o serviço de envio respondeu 502. Ela foi agrupada com a
-- família errada, e a diferença entre as duas famílias é a única coisa que
-- decide se a mensagem fica para o próximo ciclo ou some para sempre.
--
-- POR QUE ISSO NÃO REABRE A PORTA DA MENSAGEM ATRASADA
--
-- Reabrir não é reenviar: a ocorrência volta para `pendente` e só sai se a FONTE
-- ainda enumerar aquele paciente no ciclo seguinte. Para automação ancorada,
-- `janelaAncorada` limita a borda de trás em `ATRASO_MAX_MINUTOS` (30) — passou
-- disso, o paciente não é mais enumerado e a mensagem é descartada em vez de
-- chegar dizendo "sua consulta é hoje às 14h" às 17h. O guarda-corpo de frescor
-- da #19 continua sendo quem manda; esta migration só deixa de queimar a chave
-- antes de ele poder opinar.
--
-- O teto de `MAX_TENTATIVAS` (3, em `occurrences.ts`) continua sendo do MOTOR.
-- Aqui só existe a exigência de que `attempts` CRESÇA — é ela que impede uma
-- reabertura em laço, e é a mesma contenção que a 0203 escolheu.

CREATE OR REPLACE FUNCTION public.automation_occurrences_block_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- (a) A transição normal: `pendente` recebe o desfecho.
    -- (b) A retentativa: um desfecho de INDISPONIBILIDADE volta a `pendente`
    --     para o ciclo seguinte tentar de novo, e nesse caso `attempts` TEM que
    --     crescer. Exigir o incremento aqui é o que impede uma reabertura
    --     silenciosa em laço — sem ele, um bug no motor retentaria para sempre
    --     e o contador ficaria parado, mentindo sobre quantas vezes se tentou.
    --
    --     São dois desfechos, e não um: `falhou` (o serviço recusou ou não
    --     respondeu) e `impedido_sem_conexao` (o número da clínica estava fora
    --     do ar). Os outros `impedido_*` seguem finais, e por um motivo que não
    --     mudou: sem consentimento, sem telefone e sem variável não melhoram
    --     tentando de novo daqui a cinco minutos, e insistir seria voltar a
    --     procurar quem disse não.
    IF NOT (
      OLD.outcome = 'pendente'
      OR (
        OLD.outcome IN ('falhou', 'impedido_sem_conexao')
        AND NEW.outcome = 'pendente'
        AND NEW.attempts > OLD.attempts
      )
    ) THEN
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

COMMENT ON FUNCTION public.automation_occurrences_block_mutation() IS
  'Feature 056 — append-only com três exceções declaradas: pendente→desfecho; (falhou | impedido_sem_conexao)→pendente COM incremento de attempts (retentativa de indisponibilidade passageira — serviço fora do ar ou número da clínica desconectado); DELETE apenas de linha suprimida por teto. Os demais `impedido_*` seguem finais: são estados do mundo, não indisponibilidade. O UNIQUE (automation_id, patient_id, occurrence_key) continua sendo o que torna "uma vez só" propriedade do banco.';

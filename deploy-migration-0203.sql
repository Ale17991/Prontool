-- 0203 — Falha de envio deixa de ser definitiva (056).
--
-- (Nasceu como 0202 e foi renumerada: o 0202 ficou com a `0202_portal_home.sql`,
-- de outra frente que corria em paralelo no mesmo checkout.)
--
-- O QUE ACONTECEU EM PRODUÇÃO
--
-- Na primeira tentativa real de envio, em 13/08/2026, o serviço de WhatsApp
-- respondeu 502. A ocorrência foi gravada como `falhou`, e aí o desenho original
-- mostrou o problema: `falhou` era desfecho FINAL. A linha não pode ser apagada
-- (append-only) e a chave `(automação, paciente, chave)` fica ocupada para
-- sempre — então aquele paciente nunca mais receberia aquela mensagem, por causa
-- de uma indisponibilidade passageira de um serviço externo.
--
-- No dia seguinte, a mesma coisa: 502 de novo, segunda ocorrência queimada. Duas
-- mensagens perdidas definitivamente sem que nada estivesse errado com elas.
--
-- Para aniversário isso custa pouco (o dia passa de qualquer jeito). Para a
-- confirmação de consulta é grave: a mensagem que existe para reduzir falta
-- simplesmente não sai, e ninguém fica sabendo.
--
-- A ESCOLHA: reabrir a linha, não apagá-la
--
-- A supressão por teto é resolvida APAGANDO a linha, e seria fácil copiar isso
-- aqui. Seria errado por dois motivos. O primeiro é de prova: a supressão não
-- aconteceu no mundo, enquanto a falha aconteceu — houve uma tentativa, o
-- serviço respondeu, e apagar isso é apagar o registro de um evento real. O
-- segundo é de contenção: sem a linha não há onde contar tentativas, e um
-- serviço quebrado geraria retentativa infinita, ocupando a vaga do ciclo (que
-- é de UMA mensagem a cada 5 minutos) e calando todas as outras automações da
-- clínica.
--
-- Então a linha fica, ganha `attempts`, e o trigger passa a permitir a transição
-- `falhou → pendente`. Quantas vezes tentar é decisão do MOTOR, não do banco: o
-- banco só deixa de proibir. Assim mudar a política de retentativa não exige
-- migration.
--
-- `impedido_*` continua final de propósito. Sem consentimento, sem telefone,
-- sem variável: nada disso melhora tentando de novo daqui a cinco minutos, e
-- retentar seria insistir com quem disse não.

ALTER TABLE public.automation_occurrences
  ADD COLUMN IF NOT EXISTS attempts SMALLINT NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.automation_occurrences.attempts IS
  'Feature 056 — quantas vezes o envio desta ocorrência foi tentado. Começa em 1 (a linha nasce junto da primeira tentativa) e cresce a cada reabertura de `falhou`. O teto de tentativas é do MOTOR, não do banco: aqui só existe o contador.';

CREATE OR REPLACE FUNCTION public.automation_occurrences_block_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- (a) A transição normal: `pendente` recebe o desfecho.
    -- (b) A retentativa: `falhou` volta a `pendente` para o ciclo seguinte
    --     tentar de novo, e nesse caso `attempts` TEM que crescer. Exigir o
    --     incremento aqui é o que impede uma reabertura silenciosa em laço —
    --     sem ele, um bug no motor retentaria para sempre e o contador ficaria
    --     parado, mentindo sobre quantas vezes se tentou.
    IF NOT (
      OLD.outcome = 'pendente'
      OR (OLD.outcome = 'falhou' AND NEW.outcome = 'pendente' AND NEW.attempts > OLD.attempts)
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
  'Feature 056 — append-only com três exceções declaradas: pendente→desfecho; falhou→pendente COM incremento de attempts (retentativa de falha transitória de envio); DELETE apenas de linha suprimida por teto. O UNIQUE (automation_id, patient_id, occurrence_key) continua sendo o que torna "uma vez só" propriedade do banco.';

NOTIFY pgrst, 'reload schema';

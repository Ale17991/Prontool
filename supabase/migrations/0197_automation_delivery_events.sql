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

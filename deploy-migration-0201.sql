-- 0201 — A clínica escolhe quando as automações podem sair (056).
--
-- A 0199 tornou o envio uma FILA (uma mensagem a cada 5 minutos), e fila tem uma
-- consequência que o disparo instantâneo não tinha: ela escorre. Cem pendentes
-- ocupam mais de oito horas e a cauda cai na madrugada — desconfortável para o
-- paciente e, para quem observa o padrão de envio, sinal de robô.
--
-- O motor já respeitava uma janela, mas era a do LEMBRETE (`reminder_window_*`).
-- Reusar parecia certo — "a que horas esta clínica fala com os pacientes" é uma
-- pergunta só — até a clínica pedir para escolher. E ela tem razão: as duas
-- mensagens não têm a mesma tolerância. Lembrete de consulta às 7h da manhã é
-- útil para quem tem consulta às 8h; parabéns às 7h é intrusão. Uma clínica que
-- atende sábado quer lembrete no sábado e não quer promoção no sábado.
--
-- Por isso são colunas próprias — e nascem COPIANDO as do lembrete, para que
-- quem já ajustou aquela janela não veja o comportamento mudar sozinho.
--
-- OS DIAS DA SEMANA
--
-- `automation_weekdays` guarda os dias PERMITIDOS, com a convenção do JavaScript
-- (0 = domingo … 6 = sábado), que é a de `Date.getDay()` e a do `Intl` — o motor
-- lê o dia da semana pelo fuso da clínica e testa a pertinência ao array.
-- Guardar os dias PROIBIDOS seria mais curto na maioria dos casos e erraria no
-- pior: array vazio significaria "nenhum dia bloqueado", e um bug que zerasse a
-- coluna liberaria domingo em vez de calar tudo. Com os permitidos, o array
-- vazio cala — que é o lado seguro para uma feature que manda mensagem sozinha.

ALTER TABLE public.tenant_clinic_profile
  ADD COLUMN IF NOT EXISTS automation_window_start TIME,
  ADD COLUMN IF NOT EXISTS automation_window_end   TIME,
  ADD COLUMN IF NOT EXISTS automation_weekdays     SMALLINT[];

UPDATE public.tenant_clinic_profile
   SET automation_window_start = COALESCE(automation_window_start, reminder_window_start, '08:00'),
       automation_window_end   = COALESCE(automation_window_end,   reminder_window_end,   '20:00'),
       automation_weekdays     = COALESCE(automation_weekdays, ARRAY[1,2,3,4,5,6]::SMALLINT[])
 WHERE automation_window_start IS NULL
    OR automation_window_end IS NULL
    OR automation_weekdays IS NULL;

-- Domingo fica de fora do valor de fábrica. Não é preferência estética: é o dia
-- em que mensagem de clínica mais parece invasão, e a clínica que quiser liga em
-- um clique. O contrário — nascer ligado e depender de alguém lembrar de
-- desligar — erra do lado que custa o número.

ALTER TABLE public.tenant_clinic_profile
  ALTER COLUMN automation_window_start SET DEFAULT '08:00',
  ALTER COLUMN automation_window_end   SET DEFAULT '20:00',
  ALTER COLUMN automation_weekdays     SET DEFAULT ARRAY[1,2,3,4,5,6]::SMALLINT[];

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'automation_window_valid'
  ) THEN
    ALTER TABLE public.tenant_clinic_profile
      ADD CONSTRAINT automation_window_valid
      CHECK (automation_window_end > automation_window_start);
  END IF;

  -- Sem o CHECK, um `{7}` ou um `{-1}` gravado por engano viraria uma janela que
  -- nunca abre, e o sintoma seria "as automações pararam" sem nada no log
  -- apontando para a configuração.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'automation_weekdays_valid'
  ) THEN
    ALTER TABLE public.tenant_clinic_profile
      ADD CONSTRAINT automation_weekdays_valid
      CHECK (automation_weekdays <@ ARRAY[0,1,2,3,4,5,6]::SMALLINT[]);
  END IF;
END $$;

ALTER TABLE public.tenant_clinic_profile
  ALTER COLUMN automation_window_start SET NOT NULL,
  ALTER COLUMN automation_window_end   SET NOT NULL,
  ALTER COLUMN automation_weekdays     SET NOT NULL;

COMMENT ON COLUMN public.tenant_clinic_profile.automation_weekdays IS
  'Feature 056 — dias da semana em que as automações PODEM sair, na convenção do JavaScript (0 = domingo … 6 = sábado). Guarda os permitidos, e não os proibidos, para que o array vazio cale a feature em vez de liberar tudo. O que não sai hoje é reavaliado no próximo dia permitido — exceto nas fontes com chave do dia (aniversário), onde a data não volta.';

COMMENT ON COLUMN public.tenant_clinic_profile.automation_window_start IS
  'Feature 056 — hora do RELÓGIO DA CLÍNICA a partir da qual as automações podem sair. Separada da janela do lembrete de propósito: lembrete às 7h serve a quem tem consulta às 8h, parabéns às 7h é intrusão.';

NOTIFY pgrst, 'reload schema';

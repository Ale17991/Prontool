-- 0054 — Status 'agendado' (atendimento futuro) na view appointments_effective.
--
-- Antes desta migration o calendario era usado apenas para registro de
-- atendimentos ja realizados. Agora vira agenda, entao atendimentos com
-- appointment_at > NOW() devem aparecer como 'agendado' (UI marca em azul
-- claro), distintos de 'ativo' (realizado, sem reversao).
--
-- Decisao: NAO armazenar status fisicamente — continua sendo derivado da
-- view, igual a 'ativo'/'estornado'. Quando NOW() ultrapassa o
-- appointment_at, o status muda automaticamente sem UPDATE no registro
-- (Principio I — imutabilidade).
--
-- Ordem das clausulas e importante:
--   1. Reversao tem precedencia sobre tempo (estorno trumps tudo).
--   2. Futuro vira 'agendado'.
--   3. Caso contrario, 'ativo'.
--
-- A migration 0053 adicionou `duration_minutes` em appointments, o que muda
-- a expansao de `a.*` na view. Postgres CREATE OR REPLACE VIEW exige ordem
-- e tipos identicos, entao DROP+CREATE para acomodar a coluna nova.

DROP VIEW IF EXISTS public.appointments_effective;
CREATE VIEW public.appointments_effective AS
SELECT
  a.*,
  CASE
    WHEN r.id IS NOT NULL                 THEN 'estornado'
    WHEN a.appointment_at > now()         THEN 'agendado'
    ELSE                                       'ativo'
  END                                                                 AS effective_status,
  (a.frozen_amount_cents + COALESCE(r.reversal_amount_cents, 0))      AS net_amount_cents,
  (
    (a.frozen_amount_cents + COALESCE(r.reversal_amount_cents, 0))
    * a.frozen_commission_bps / 10000
  )                                                                    AS net_commission_cents,
  r.id         AS reversal_id,
  r.created_at AS reversed_at
FROM public.appointments a
LEFT JOIN public.appointment_reversals r ON r.appointment_id = a.id;

-- 0148 — Recria a view appointments_effective para expor `is_return`.
--
-- BUG: a 0139 adicionou `appointments.is_return` assumindo que a view
-- `appointments_effective` (definida com `SELECT a.*`) herdaria a coluna
-- automaticamente. Não herda: o PostgreSQL expande `a.*` para a lista de
-- colunas NO MOMENTO em que a view é criada e congela essa lista. A última
-- (re)criação da view foi na 0096 — antes da coluna existir —, então a view
-- nunca passou a ter `is_return`.
--
-- Sintoma: o modo Calendário usa `list-week.ts`, que faz
-- `SELECT ... is_return FROM appointments_effective`. A coluna ausente faz o
-- PostgREST retornar 42703 ("column does not exist"); o fallback de coluna
-- ausente em list-week só cobre `duration_minutes`, então a query lança e a
-- página de Atendimentos cai silenciosamente para o modo Lista (try/catch em
-- page.tsx). A Lista funciona porque a query dela não seleciona `is_return`.
--
-- Fix: DROP + CREATE da view com o MESMO corpo da 0096. Como é `SELECT a.*`,
-- a recriação reexpande e passa a incluir `is_return` (e quaisquer outras
-- colunas aditivas adicionadas a `appointments` desde a 0096). Aditiva,
-- idempotente. Funções de repasse/notificação que leem a view não criam
-- dependência que bloqueie o DROP (a 0096 já dropava sem CASCADE).

DROP VIEW IF EXISTS public.appointments_effective;
CREATE VIEW public.appointments_effective AS
SELECT
  a.*,
  CASE
    WHEN r.id  IS NOT NULL THEN 'estornado'
    WHEN x.id  IS NOT NULL THEN 'cancelado'
    WHEN c.id  IS NOT NULL THEN 'ativo'
    WHEN cf.id IS NOT NULL THEN 'confirmado'
    ELSE                        'agendado'
  END                                                                 AS effective_status,
  (a.frozen_amount_cents + COALESCE(r.reversal_amount_cents, 0))      AS net_amount_cents,
  (
    (a.frozen_amount_cents + COALESCE(r.reversal_amount_cents, 0))
    * a.frozen_commission_bps / 10000
  )                                                                    AS net_commission_cents,
  r.id           AS reversal_id,
  r.created_at   AS reversed_at,
  c.id           AS completion_id,
  c.completed_at,
  cf.id          AS confirmation_id,
  cf.confirmed_at,
  x.id           AS cancellation_id,
  x.cancelled_at,
  x.reason       AS cancellation_reason,
  (a.appointment_at + COALESCE(a.duration_minutes, 30) * interval '1 minute') AS appointment_ends_at
FROM public.appointments a
LEFT JOIN public.appointment_reversals      r  ON r.appointment_id  = a.id
LEFT JOIN public.appointment_completions    c  ON c.appointment_id  = a.id
LEFT JOIN public.appointment_confirmations  cf ON cf.appointment_id = a.id
LEFT JOIN public.appointment_cancellations  x  ON x.appointment_id  = a.id;
ALTER VIEW IF EXISTS public.appointments_effective SET (security_invoker = true);

NOTIFY pgrst, 'reload schema';

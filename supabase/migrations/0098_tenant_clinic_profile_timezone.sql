-- 0098 — Acrescenta coluna `timezone` em tenant_clinic_profile.
--
-- Bug latente da 0095: as funcoes close_monthly_payout e
-- generate_payout_adjustment_if_closed fazem
--   SELECT COALESCE(timezone, 'America/Sao_Paulo') ... FROM tenant_clinic_profile
-- mas a coluna `timezone` nunca foi criada (nao consta na 0064 nem em
-- nenhum ALTER posterior). Resultado:
--   ERROR: column "timezone" does not exist (SQLSTATE 42703).
--
-- O bug nao tinha sido exercido antes porque o trigger
-- ar_generate_payout_adjustment so' dispara em estornos de meses
-- fechados. A nova RPC cancel_appointment (0096/0097) passou a criar
-- estornos automaticamente em qualquer cancelamento de atendimento
-- realizado, expondo o bug em todo cancelamento de 'ativo'.
--
-- Fix idempotente: ADD COLUMN IF NOT EXISTS com default
-- 'America/Sao_Paulo' (mesmo fallback ja usado no COALESCE das
-- funcoes). Sem migration de dados — todas as linhas existentes
-- recebem o default.

ALTER TABLE public.tenant_clinic_profile
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo';

COMMENT ON COLUMN public.tenant_clinic_profile.timezone IS
  'Fuso horario da clinica (IANA). Default America/Sao_Paulo. Usado por funcoes que precisam materializar meses civis a partir de TIMESTAMPTZ (close_monthly_payout, generate_payout_adjustment_if_closed).';

NOTIFY pgrst, 'reload schema';

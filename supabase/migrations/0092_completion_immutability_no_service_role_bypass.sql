-- 0092 — Remove `service_role` do bypass de
-- enforce_appointment_completion_immutability (E7).
--
-- Antes (0055:47-60): trigger BEFORE UPDATE OR DELETE em
-- appointment_completions bypassava `service_role`/`supabase_auth_admin`.
-- Princípio I (auditabilidade financeira) considera completions
-- append-only stricto — mas API routes via service_role podiam mutar
-- silenciosamente. Mesma classe de problema que H1 (enforce_last_admin).
--
-- Verificação: grep no codebase não acha nenhum UPDATE/DELETE em
-- appointment_completions. Path legítimo é só INSERT (mark_appointment_realized
-- RPC e step_status_sync_to_appointment trigger). Triggers BEFORE UPDATE/DELETE
-- não disparam em INSERT, então o flow normal não é afetado.
--
-- Mantemos bypass para `postgres` e `supabase_admin` (migração/seed) — esses
-- são roles de manutenção, não de runtime de aplicação.

CREATE OR REPLACE FUNCTION public.enforce_appointment_completion_immutability()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Bypass apenas para roles de manutenção. service_role REMOVIDO:
  -- API routes precisam fazer reversal explícita via appointment_reversals
  -- em vez de UPDATE/DELETE direto.
  IF current_user IN ('postgres', 'supabase_admin') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'appointment_completions is append-only';
END $$;

NOTIFY pgrst, 'reload schema';

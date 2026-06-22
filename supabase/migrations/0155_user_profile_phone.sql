-- 0155 — Telefone no perfil do usuário (edição de dados da equipe).
--
-- `user_profile` não tinha telefone (a coluna `phone` da 0064 é da
-- `tenant_clinic_profile`, da clínica). O cadastro manual já tentava gravar
-- `phone` em user_profile (best-effort) — agora a coluna existe de fato.
-- Aditiva e idempotente.

ALTER TABLE public.user_profile
  ADD COLUMN IF NOT EXISTS phone TEXT;

NOTIFY pgrst, 'reload schema';

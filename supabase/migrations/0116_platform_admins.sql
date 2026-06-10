-- 0116 — Admin-Agência: usuário de plataforma cross-tenant (feature 031).
--
-- Papel ACIMA dos tenants: enquanto user_tenants/RBAC governam papéis DENTRO
-- de uma clínica, platform_admins marca quem administra TODAS as clínicas
-- (painel /admin, gestão de planos/módulos).
--
-- Concessão é MANUAL via Supabase (insert direto) — não há UI para conceder.
-- Bootstrap (rodar no Supabase SQL do projeto de produção):
--   INSERT INTO public.platform_admins (user_id)
--   SELECT id FROM auth.users WHERE email = 'clinnipro@gmail.com'
--   ON CONFLICT DO NOTHING;
--
-- Segurança: RLS ligado e SEM policy para `authenticated` — a tabela não é
-- legível nem editável pelo app; a checagem do servidor usa o service_role
-- (que bypassa RLS). Reversibilidade: aditiva, idempotente.

CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note       TEXT NULL
);

COMMENT ON TABLE public.platform_admins IS
  'Feature 031 — usuários Admin-Agência (plataforma, cross-tenant). Concessão manual via Supabase. Sem acesso por authenticated; checagem server-side via service_role.';

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
-- Intencional: nenhuma policy para `authenticated`. Apenas service_role
-- (bypassa RLS) lê/escreve. Sem GRANT para authenticated.

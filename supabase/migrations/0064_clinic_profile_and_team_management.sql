-- 0064 — Configurações da clínica, perfil do usuário e gestão de equipe.
--
-- Adiciona:
--   1. tabela tenant_clinic_profile (1:1 com tenants) — logo, dados oficiais,
--      endereço, responsável técnico. RLS por tenant; UPDATE restrito a admin.
--   2. tabela user_profile (1:1 com auth.users) — nome, foto, fuso. Self-write,
--      cross-read dentro do mesmo tenant para exibir avatar em listas de
--      autoria.
--   3. ALTER user_tenants: colunas status / disabled_at / disabled_by para
--      permitir desativação reversível sem perder histórico (Princípio II).
--   4. função is_last_active_admin(tenant, user) e trigger enforce_last_admin
--      que impede desativar/rebaixar a única administradora ativa do tenant.
--   5. Atualização do auth_hook_custom_claims (originalmente em 0019) para
--      omitir tenant_id/role quando user_tenants.status = 'disabled' — isso
--      é o kill-switch que invalida sessão de usuário desativado na próxima
--      requisição (jwt_tenant_id() volta NULL → todas as policies negam).
--   6. Buckets privados clinic-logos e user-avatars com policies RLS no
--      mesmo padrão de expense-receipts (0058): primeiro segmento do path =
--      tenant_id; second segment para avatar = user_id.
--
-- Constituição: Principles II (audit), III (RLS), V (RBAC) cobertos.
-- Reversibilidade: aditiva e idempotente. Em dev, supabase:reset recria.

-- =========================================================================
-- 1. tenant_clinic_profile
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.tenant_clinic_profile (
  tenant_id                       UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE RESTRICT,
  logo_path                       TEXT NULL,
  logo_uploaded_at                TIMESTAMPTZ NULL,
  corporate_name                  TEXT NULL CHECK (corporate_name IS NULL OR length(corporate_name) <= 200),
  cnpj                            CHAR(14) NULL CHECK (cnpj IS NULL OR cnpj ~ '^[0-9]{14}$'),
  phone                           TEXT NULL CHECK (phone IS NULL OR length(phone) <= 20),
  email                           TEXT NULL CHECK (email IS NULL OR length(email) <= 200),
  address_cep                     CHAR(8) NULL CHECK (address_cep IS NULL OR address_cep ~ '^[0-9]{8}$'),
  address_street                  TEXT NULL CHECK (address_street IS NULL OR length(address_street) <= 200),
  address_number                  TEXT NULL CHECK (address_number IS NULL OR length(address_number) <= 20),
  address_complement              TEXT NULL CHECK (address_complement IS NULL OR length(address_complement) <= 100),
  address_neighborhood            TEXT NULL CHECK (address_neighborhood IS NULL OR length(address_neighborhood) <= 100),
  address_city                    TEXT NULL CHECK (address_city IS NULL OR length(address_city) <= 100),
  address_uf                      CHAR(2) NULL CHECK (address_uf IS NULL OR address_uf ~ '^[A-Z]{2}$'),
  tech_responsible_name           TEXT NULL CHECK (tech_responsible_name IS NULL OR length(tech_responsible_name) <= 200),
  tech_responsible_council        TEXT NULL CHECK (tech_responsible_council IS NULL OR tech_responsible_council ~ '^[A-Z]{3,12}$'),
  tech_responsible_registration   TEXT NULL CHECK (tech_responsible_registration IS NULL OR length(tech_responsible_registration) <= 30),
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS tenant_clinic_profile_touch_updated_at ON public.tenant_clinic_profile;
CREATE TRIGGER tenant_clinic_profile_touch_updated_at
  BEFORE UPDATE ON public.tenant_clinic_profile
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.tenant_clinic_profile ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_clinic_profile_read ON public.tenant_clinic_profile;
CREATE POLICY tenant_clinic_profile_read ON public.tenant_clinic_profile
  FOR SELECT TO authenticated
  USING (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS tenant_clinic_profile_insert ON public.tenant_clinic_profile;
CREATE POLICY tenant_clinic_profile_insert ON public.tenant_clinic_profile
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() = 'admin');

DROP POLICY IF EXISTS tenant_clinic_profile_update ON public.tenant_clinic_profile;
CREATE POLICY tenant_clinic_profile_update ON public.tenant_clinic_profile
  FOR UPDATE TO authenticated
  USING (tenant_id = public.jwt_tenant_id() AND public.jwt_role() = 'admin')
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() = 'admin');

GRANT SELECT, INSERT, UPDATE ON public.tenant_clinic_profile TO authenticated;

-- =========================================================================
-- 2. user_tenants — colunas de status (precede user_profile porque a policy
--    de leitura cross-user de user_profile referencia user_tenants.status).
-- =========================================================================

ALTER TABLE public.user_tenants
  ADD COLUMN IF NOT EXISTS status      TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS disabled_by UUID NULL REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS user_tenants_active_admin_idx
  ON public.user_tenants (tenant_id)
  WHERE role = 'admin' AND status = 'active';

-- Permitir UPDATE direto via authenticated nas colunas de status pelos
-- admins do mesmo tenant. RLS já cobre tenant_id implicitamente via JWT.
DROP POLICY IF EXISTS user_tenants_admin_update ON public.user_tenants;
CREATE POLICY user_tenants_admin_update ON public.user_tenants
  FOR UPDATE TO authenticated
  USING (tenant_id = public.jwt_tenant_id() AND public.jwt_role() = 'admin')
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() = 'admin');

GRANT UPDATE (role, status, disabled_at, disabled_by) ON public.user_tenants TO authenticated;

-- =========================================================================
-- 3. user_profile
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.user_profile (
  user_id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name            TEXT NULL CHECK (full_name IS NULL OR length(full_name) <= 200),
  avatar_path          TEXT NULL,
  avatar_uploaded_at   TIMESTAMPTZ NULL,
  timezone             TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS user_profile_touch_updated_at ON public.user_profile;
CREATE TRIGGER user_profile_touch_updated_at
  BEFORE UPDATE ON public.user_profile
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.user_profile ENABLE ROW LEVEL SECURITY;

-- Self-read OR cross-read entre membros ativos do mesmo tenant ativo (para
-- exibir avatares em listagens de autoria).
DROP POLICY IF EXISTS user_profile_self_or_same_tenant_read ON public.user_profile;
CREATE POLICY user_profile_self_or_same_tenant_read ON public.user_profile
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.user_tenants ut_other
      WHERE ut_other.user_id = public.user_profile.user_id
        AND ut_other.tenant_id = public.jwt_tenant_id()
        AND ut_other.status = 'active'
    )
  );

DROP POLICY IF EXISTS user_profile_self_insert ON public.user_profile;
CREATE POLICY user_profile_self_insert ON public.user_profile
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS user_profile_self_update ON public.user_profile;
CREATE POLICY user_profile_self_update ON public.user_profile
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE ON public.user_profile TO authenticated;

-- =========================================================================
-- 4. is_last_active_admin + enforce_last_admin trigger
-- =========================================================================

CREATE OR REPLACE FUNCTION public.is_last_active_admin(p_tenant_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM public.user_tenants
    WHERE tenant_id = p_tenant_id
      AND user_id <> p_user_id
      AND role = 'admin'
      AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.enforce_last_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Bypass para roles administrativas do banco — manutenção/seed.
  IF current_user IN ('postgres', 'supabase_admin', 'service_role') THEN
    RETURN NEW;
  END IF;

  -- Só intervém quando a row alvo é admin ativa hoje e está saindo dessa
  -- combinação (mudando role ou status). Se a row é a única admin ativa
  -- do tenant, rejeita.
  IF OLD.role = 'admin' AND OLD.status = 'active'
     AND (NEW.role <> 'admin' OR NEW.status <> 'active')
     AND public.is_last_active_admin(OLD.tenant_id, OLD.user_id) THEN
    RAISE EXCEPTION
      'Não é possível desativar ou rebaixar a única administradora ativa do tenant'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS user_tenants_enforce_last_admin ON public.user_tenants;
CREATE TRIGGER user_tenants_enforce_last_admin
  BEFORE UPDATE ON public.user_tenants
  FOR EACH ROW EXECUTE FUNCTION public.enforce_last_admin();

-- =========================================================================
-- 5. auth_hook_custom_claims — filtra status='active'
-- =========================================================================

-- Mantém a estrutura corrigida em 0022 (claims escritas em app_metadata,
-- jsonb text-accessors corretos). A única adição é o filtro por
-- `status = 'active'` em ambos os SELECTs — usuário desativado não
-- recebe claims, então jwt_tenant_id() / jwt_role() retornam NULL na
-- próxima requisição e todas as policies RLS rejeitam (kill-switch).
CREATE OR REPLACE FUNCTION public.auth_hook_custom_claims(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid         UUID;
  desired_tid UUID;
  picked_tid  UUID;
  picked_role TEXT;
  claims      jsonb;
BEGIN
  uid := NULLIF(event ->> 'user_id', '')::uuid;
  desired_tid := NULLIF(event #>> '{user_metadata,active_tenant_id}', '')::uuid;

  IF desired_tid IS NOT NULL THEN
    SELECT tenant_id, role INTO picked_tid, picked_role
    FROM public.user_tenants
    WHERE user_id = uid
      AND tenant_id = desired_tid
      AND status = 'active'
    LIMIT 1;
  END IF;

  IF picked_tid IS NULL THEN
    SELECT tenant_id, role INTO picked_tid, picked_role
    FROM public.user_tenants
    WHERE user_id = uid
      AND status = 'active'
    LIMIT 1;
  END IF;

  claims := COALESCE(event -> 'claims', '{}'::jsonb);
  IF picked_tid IS NOT NULL THEN
    claims := jsonb_set(
      claims,
      '{app_metadata}',
      COALESCE(claims -> 'app_metadata', '{}'::jsonb)
        || jsonb_build_object('tenant_id', picked_tid::text, 'role', picked_role),
      true
    );
  END IF;

  RETURN jsonb_set(event, '{claims}', claims);
END $$;

GRANT EXECUTE ON FUNCTION public.auth_hook_custom_claims(jsonb) TO supabase_auth_admin;

-- =========================================================================
-- 6. Buckets clinic-logos + user-avatars
-- =========================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('clinic-logos', 'clinic-logos', false),
       ('user-avatars', 'user-avatars', false)
ON CONFLICT (id) DO NOTHING;

-- ---- clinic-logos ----
-- Read: qualquer membro autenticado do mesmo tenant.
-- Write/Delete: apenas admin do mesmo tenant.

DROP POLICY IF EXISTS clinic_logos_tenant_read ON storage.objects;
CREATE POLICY clinic_logos_tenant_read
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'clinic-logos'
    AND (storage.foldername(name))[1] = public.jwt_tenant_id()::text
  );

DROP POLICY IF EXISTS clinic_logos_admin_insert ON storage.objects;
CREATE POLICY clinic_logos_admin_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'clinic-logos'
    AND (storage.foldername(name))[1] = public.jwt_tenant_id()::text
    AND public.jwt_role() = 'admin'
  );

DROP POLICY IF EXISTS clinic_logos_admin_update ON storage.objects;
CREATE POLICY clinic_logos_admin_update
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'clinic-logos'
    AND (storage.foldername(name))[1] = public.jwt_tenant_id()::text
    AND public.jwt_role() = 'admin'
  );

DROP POLICY IF EXISTS clinic_logos_admin_delete ON storage.objects;
CREATE POLICY clinic_logos_admin_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'clinic-logos'
    AND (storage.foldername(name))[1] = public.jwt_tenant_id()::text
    AND public.jwt_role() = 'admin'
  );

-- ---- user-avatars ----
-- Read: qualquer membro autenticado do mesmo tenant.
-- Write/Delete: apenas o dono (path = {tenant_id}/{user_id}.{ext}).

DROP POLICY IF EXISTS user_avatars_tenant_read ON storage.objects;
CREATE POLICY user_avatars_tenant_read
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'user-avatars'
    AND (storage.foldername(name))[1] = public.jwt_tenant_id()::text
  );

DROP POLICY IF EXISTS user_avatars_self_insert ON storage.objects;
CREATE POLICY user_avatars_self_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'user-avatars'
    AND (storage.foldername(name))[1] = public.jwt_tenant_id()::text
    AND split_part((storage.foldername(name))[2], '.', 1) = auth.uid()::text
  );

DROP POLICY IF EXISTS user_avatars_self_update ON storage.objects;
CREATE POLICY user_avatars_self_update
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'user-avatars'
    AND (storage.foldername(name))[1] = public.jwt_tenant_id()::text
    AND split_part((storage.foldername(name))[2], '.', 1) = auth.uid()::text
  );

DROP POLICY IF EXISTS user_avatars_self_delete ON storage.objects;
CREATE POLICY user_avatars_self_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'user-avatars'
    AND (storage.foldername(name))[1] = public.jwt_tenant_id()::text
    AND split_part((storage.foldername(name))[2], '.', 1) = auth.uid()::text
  );

-- =========================================================================
-- Comments / docs
-- =========================================================================

COMMENT ON TABLE  public.tenant_clinic_profile IS '1:1 com tenants. Identidade institucional (logo, CNPJ, endereço, responsável técnico). Editável apenas por admin via RLS.';
COMMENT ON TABLE  public.user_profile          IS '1:1 com auth.users. Preferências individuais (foto, nome de exibição, fuso). Self-write; cross-read dentro do mesmo tenant para listas de autoria.';
COMMENT ON COLUMN public.user_tenants.status   IS 'active | disabled — desativar remove acesso sem apagar histórico (Princípio II). Disabled é filtrado pelo auth_hook_custom_claims.';
COMMENT ON FUNCTION public.is_last_active_admin(UUID, UUID) IS 'Retorna true se p_user_id é a única admin ativa do tenant (excluindo a própria row).';

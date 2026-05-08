# Data Model — Configurações da Clínica, Perfil, Equipe

**Feature**: 009-configuracoes-clinica-equipe
**Phase**: 1 (Design & Contracts)
**Date**: 2026-05-08
**Migration**: `supabase/migrations/0064_clinic_profile_and_team_management.sql`

---

## Entities

### 1. `tenant_clinic_profile` (NEW)

Identidade institucional do tenant. 1:1 com `public.tenants`.

| Coluna | Tipo | Constraint | Notas |
|--------|------|------------|-------|
| `tenant_id` | UUID | PRIMARY KEY, FK `tenants(id)` ON DELETE RESTRICT | reusa o id do tenant |
| `logo_path` | TEXT | NULL | path no bucket `clinic-logos`; ex: `{tenant_id}/logo.png` |
| `logo_uploaded_at` | TIMESTAMPTZ | NULL | quando a logo atual foi subida |
| `corporate_name` | TEXT | NULL, length ≤ 200 | razão social/nome fantasia |
| `cnpj` | CHAR(14) | NULL, CHECK `cnpj IS NULL OR cnpj ~ '^[0-9]{14}$'` | só dígitos; máscara é UI |
| `phone` | TEXT | NULL, length ≤ 20 | só dígitos preferencialmente |
| `email` | TEXT | NULL, length ≤ 200 | e-mail de contato da clínica |
| `address_cep` | CHAR(8) | NULL, CHECK `address_cep IS NULL OR address_cep ~ '^[0-9]{8}$'` | |
| `address_street` | TEXT | NULL, length ≤ 200 | |
| `address_number` | TEXT | NULL, length ≤ 20 | |
| `address_complement` | TEXT | NULL, length ≤ 100 | |
| `address_neighborhood` | TEXT | NULL, length ≤ 100 | |
| `address_city` | TEXT | NULL, length ≤ 100 | |
| `address_uf` | CHAR(2) | NULL, CHECK `address_uf IS NULL OR address_uf ~ '^[A-Z]{2}$'` | |
| `tech_responsible_name` | TEXT | NULL, length ≤ 200 | |
| `tech_responsible_council` | TEXT | NULL, CHECK `tech_responsible_council IS NULL OR tech_responsible_council ~ '^[A-Z]{3,12}$'` | CRM, CRO, CREFITO, CRP, CRN, etc. |
| `tech_responsible_registration` | TEXT | NULL, length ≤ 30 | número de registro |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | trigger `touch_updated_at` |

**Validações de domínio** (server, em `update.ts`):
- CNPJ: 14 dígitos + dígitos verificadores via algoritmo módulo 11.
- Email: regex padrão + `length` ≤ 200.
- UF: enum dos 27 estados brasileiros.
- Council: aceita o conjunto comum (CRM, CRO, CREFITO, CRP, CRN, COREN, CRF, CRBM, CRESS) — lista validada em Zod, não em DB.

**RLS**:
```sql
ALTER TABLE public.tenant_clinic_profile ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_clinic_profile_read ON public.tenant_clinic_profile
  FOR SELECT TO authenticated
  USING (tenant_id = public.jwt_tenant_id());

CREATE POLICY tenant_clinic_profile_insert ON public.tenant_clinic_profile
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() = 'admin');

CREATE POLICY tenant_clinic_profile_update ON public.tenant_clinic_profile
  FOR UPDATE TO authenticated
  USING (tenant_id = public.jwt_tenant_id() AND public.jwt_role() = 'admin')
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() = 'admin');

-- DELETE: bloqueado em produção; cleanup só via service-role.
```

**Triggers**:
- `tenant_clinic_profile_touch_updated_at`: BEFORE UPDATE → `touch_updated_at()` (já existe).

**State**: row inserida lazy — quando o admin acessa `/configuracoes/clinica` pela primeira vez, o handler faz `INSERT ... ON CONFLICT DO NOTHING` se ainda não existir. Não há "perfil rascunho vs publicado".

---

### 2. `user_profile` (NEW)

Preferências individuais do usuário. 1:1 com `auth.users`.

| Coluna | Tipo | Constraint | Notas |
|--------|------|------------|-------|
| `user_id` | UUID | PRIMARY KEY, FK `auth.users(id)` ON DELETE CASCADE | |
| `full_name` | TEXT | NULL, length ≤ 200 | nome completo de exibição |
| `avatar_path` | TEXT | NULL | path no bucket `user-avatars`; ex: `{tenant_id}/{user_id}.png`. Como o avatar é por usuário e os tenants podem ter regras diferentes, persistir o tenant_id na qual o avatar foi subido permite RLS no Storage. Para o caso de usuário com múltiplos tenants ver R4. |
| `avatar_uploaded_at` | TIMESTAMPTZ | NULL | |
| `timezone` | TEXT | NOT NULL DEFAULT 'America/Sao_Paulo' | IANA TZ |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |

**RLS**:
```sql
ALTER TABLE public.user_profile ENABLE ROW LEVEL SECURITY;

-- Self-read e read de membros do mesmo tenant (para listagens de autoria).
CREATE POLICY user_profile_self_or_same_tenant_read ON public.user_profile
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_tenants ut1
      JOIN public.user_tenants ut2 ON ut1.tenant_id = ut2.tenant_id
      WHERE ut1.user_id = auth.uid() AND ut1.status = 'active'
        AND ut2.user_id = public.user_profile.user_id AND ut2.status = 'active'
        AND ut1.tenant_id = public.jwt_tenant_id()
    )
  );

-- Insert/Update apenas próprio usuário.
CREATE POLICY user_profile_self_insert ON public.user_profile
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY user_profile_self_update ON public.user_profile
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
```

**State**: row criada lazy no primeiro acesso a `/configuracoes/perfil`.

---

### 3. `user_tenants` (ALTERED)

Tabela existente (migration 0002). Alterações:

```sql
ALTER TABLE public.user_tenants
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS disabled_by UUID NULL REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS user_tenants_active_admin_idx
  ON public.user_tenants (tenant_id)
  WHERE role = 'admin' AND status = 'active';
```

**Function `is_last_active_admin`** (helper):

```sql
CREATE OR REPLACE FUNCTION public.is_last_active_admin(p_tenant_id UUID, p_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.user_tenants
    WHERE tenant_id = p_tenant_id
      AND user_id <> p_user_id
      AND role = 'admin'
      AND status = 'active'
  );
$$;
```

**Trigger `enforce_last_admin`** (BEFORE UPDATE):

```sql
CREATE OR REPLACE FUNCTION public.enforce_last_admin()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('postgres','supabase_admin','service_role') THEN RETURN NEW; END IF;

  -- Se row alvo é admin ativa hoje e está saindo de admin OU saindo de active:
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
```

**State machine**:

```
[non-existent] → (invite) → status=active, email_confirmed_at=NULL → "Convite pendente"
                       ↓ (user accepts link, sets password)
                          status=active, email_confirmed_at=NOT NULL → "Ativo"
                       ↓ (admin disables)
                          status=disabled → "Desativado"
                       ↓ (admin reactivates)
                          status=active → "Ativo" (sem novo convite)
```

**RBAC adjustments**:
- A função existente `public.jwt_role()` continua autoritativa.
- A custom-claims function (migration 0019) **deve** ser atualizada para **omitir** `tenant_id`/`role` quando a row em `user_tenants` está com `status='disabled'` — efetivamente expulsando o usuário desativado das policies de RLS na próxima requisição (R15).

---

### 4. Interaction with `audit_log` (USE, no schema change)

Eventos novos a registrar:

| Evento | `entity` | `entity_id` | `field` | `old_value` / `new_value` |
|--------|----------|-------------|---------|---------------------------|
| Atualização de dados da clínica | `tenant_clinic_profile` | `tenant_id` | nome do campo (`corporate_name`, `cnpj`, `address_cep`, …) — uma linha por campo alterado | string anterior / nova |
| Upload de logo | `tenant_clinic_profile` | `tenant_id` | `logo` | path antigo / path novo |
| Convite enviado | `user_tenants` | `user_id` | `invite` | `null` / `{ email, role }` |
| Mudança de papel | `user_tenants` | `user_id` | `role` | papel antigo / novo |
| Desativação | `user_tenants` | `user_id` | `status` | `active` / `disabled` |
| Reativação | `user_tenants` | `user_id` | `status` | `disabled` / `active` |
| Troca de senha | `user_profile` | `user_id` | `password` | `null` / `null` (apenas registro temporal) |
| Atualização de perfil pessoal | `user_profile` | `user_id` | nome do campo (`full_name`, `timezone`) | string anterior / nova |
| Upload de avatar | `user_profile` | `user_id` | `avatar` | path antigo / path novo |

**Reason field**: textual, gerado pelo handler (ex.: `"updated by /api/configuracoes/clinica PUT"`). Para mudança de papel sensível (`admin` ↔ outros), o front pode pedir uma justificativa textual e enviá-la — mas não é obrigatório no MVP (campo `reason` aceita string padrão).

---

### 5. Storage: `clinic-logos` and `user-avatars` (NEW BUCKETS)

Inseridos em `storage.buckets` no mesmo arquivo de migration:

```sql
INSERT INTO storage.buckets (id, name, public)
VALUES ('clinic-logos', 'clinic-logos', false),
       ('user-avatars', 'user-avatars', false)
ON CONFLICT (id) DO NOTHING;
```

**Policies**: ver R4 do `research.md`.

**Path schemas**:
- `clinic-logos`: `{tenant_id}/logo.{jpg|png}`
- `user-avatars`: `{tenant_id}/{user_id}.{jpg|png}`

Substituição de imagem **sobrescreve** o objeto existente (mesmo path), evitando blobs órfãos.

---

## Relationship Diagram

```text
auth.users 1—1 user_profile
auth.users 1—N user_tenants N—1 tenants
                              tenants 1—1 tenant_clinic_profile

storage.buckets("clinic-logos")     ← path[1] = tenants.id
storage.buckets("user-avatars")     ← path[1] = tenants.id, path[2] = auth.users.id
audit_log                           ← entity ∈ {tenant_clinic_profile, user_profile, user_tenants}
```

---

## Migration Notes

- `0064_clinic_profile_and_team_management.sql` é puramente aditiva. Reversível em dev (`supabase:reset`) — em produção, drop de `tenant_clinic_profile` ou `user_profile` exigiria plano de retenção (Constituição §"Migrações"). Para esta feature não é planejado drop.
- O `auth_hook_custom_claims` da 0019 **será atualizado** dentro desta migration para o filtro `WHERE status = 'active'`. Como já existe e é `CREATE OR REPLACE FUNCTION`, é compatível com replay idempotente.
- Bucket creates usam `ON CONFLICT DO NOTHING` para idempotência.
- Os 5 redirects de rota não tocam DB — ficam em `src/middleware.ts`.

---

## Out of Scope (data model)

- Histórico de logos antigas (apenas atual).
- Múltiplos responsáveis técnicos.
- Múltiplas filiais por tenant.
- Tabela `invitations` separada — derivada (R6).

# Data Model — Multi-Tenant Lifecycle, GHL 1:1 Binding e Filtros do Calendário

**Feature**: 010-multi-tenant-ghl-calendar
**Phase**: 1 (Design & Contracts)
**Date**: 2026-05-08
**Migration**: `supabase/migrations/0065_active_tenant_and_signup.sql`

Mudanças minimalistas — o pilar é reuso das estruturas das features 002 / 008 / 009. Esta feature acrescenta:

1. **Tabela nova**: `user_active_tenant` (1:1 com `auth.users`).
2. **Função SQL nova**: `create_first_tenant(...)` SECURITY DEFINER (atomicidade do onboarding).
3. **Função SQL alterada**: `auth_hook_custom_claims` ganha leitura adicional de `user_active_tenant`.

Nenhuma tabela de domínio (`tenants`, `tenant_integrations`, `user_tenants`, `appointments`, `audit_log`) tem ALTER. Todas as outras user stories (US1, US3, US4) trabalham por cima do schema existente.

---

## Entities

### 1. `user_active_tenant` (NEW)

Persistência da "última clínica usada" por usuário. 1:1 com `auth.users`.

| Coluna | Tipo | Constraint | Notas |
|--------|------|------------|-------|
| `user_id` | UUID | PRIMARY KEY, FK `auth.users(id)` ON DELETE CASCADE | |
| `tenant_id` | UUID | NOT NULL, FK `tenants(id)` ON DELETE CASCADE | quando o tenant é apagado, a row some — o user fica sem ativa |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | atualizado em cada switch ou login que resolve um tenant |

**RLS**:

```sql
ALTER TABLE public.user_active_tenant ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_active_tenant_self_read ON public.user_active_tenant;
CREATE POLICY user_active_tenant_self_read ON public.user_active_tenant
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- INSERT/UPDATE: somente service-role / RPC SECURITY DEFINER (auth_hook
-- e switch-tenant correm com privilégio elevado para escrever).
```

**Triggers**: `touch_updated_at`.

**State**: row existe enquanto user tem ao menos um tenant ativo. Apagar via switch para outro tenant (UPSERT atualiza); deletar quando usuário perde todos os vínculos (CASCADE da FK do tenant).

---

### 2. Function `create_first_tenant` (NEW, SECURITY DEFINER)

Atomicidade do onboarding (FR-014).

```sql
CREATE OR REPLACE FUNCTION public.create_first_tenant(
  p_user_id UUID,
  p_name    TEXT,
  p_slug    TEXT,
  p_cnpj    TEXT DEFAULT NULL,
  p_phone   TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  new_tenant_id UUID;
BEGIN
  -- Defesa: o caller (RPC sem service-role) só pode criar tenant pra si mesmo.
  IF p_user_id IS NULL OR p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'create_first_tenant: p_user_id must equal auth.uid()'
      USING ERRCODE = '42501';
  END IF;

  -- Tenant
  INSERT INTO public.tenants (name, slug, status)
  VALUES (p_name, p_slug, 'active')
  RETURNING id INTO new_tenant_id;

  -- Vínculo admin
  INSERT INTO public.user_tenants (user_id, tenant_id, role, status)
  VALUES (p_user_id, new_tenant_id, 'admin', 'active');

  -- Última usada
  INSERT INTO public.user_active_tenant (user_id, tenant_id, updated_at)
  VALUES (p_user_id, new_tenant_id, now())
  ON CONFLICT (user_id) DO UPDATE
    SET tenant_id = EXCLUDED.tenant_id, updated_at = now();

  -- Lazy init do clinic profile (CNPJ/phone opcionais).
  INSERT INTO public.tenant_clinic_profile (tenant_id, cnpj, phone)
  VALUES (
    new_tenant_id,
    NULLIF(regexp_replace(COALESCE(p_cnpj, ''), '\D', '', 'g'), ''),
    NULLIF(p_phone, '')
  );

  RETURN new_tenant_id;
END $$;

GRANT EXECUTE ON FUNCTION public.create_first_tenant(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;
```

**Failure modes**:
- Slug colide → `unique_violation` (caller resolve).
- Telefone/CNPJ inválidos: a RPC não valida formato (front-end já validou); apenas normaliza.

---

### 3. Function `auth_hook_custom_claims` (ALTERED)

Nova ordem de leitura (R6 do `research.md`):

```sql
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

  -- (1) Hint do switch atual.
  IF desired_tid IS NOT NULL THEN
    SELECT tenant_id, role INTO picked_tid, picked_role
    FROM public.user_tenants
    WHERE user_id = uid AND tenant_id = desired_tid AND status = 'active'
    LIMIT 1;
  END IF;

  -- (2) Última usada (cross-device).
  IF picked_tid IS NULL THEN
    SELECT ut.tenant_id, ut.role INTO picked_tid, picked_role
    FROM public.user_active_tenant uat
    JOIN public.user_tenants ut
      ON ut.user_id = uat.user_id AND ut.tenant_id = uat.tenant_id
    WHERE uat.user_id = uid AND ut.status = 'active'
    LIMIT 1;
  END IF;

  -- (3) Fallback: primeiro tenant ativo.
  IF picked_tid IS NULL THEN
    SELECT tenant_id, role INTO picked_tid, picked_role
    FROM public.user_tenants
    WHERE user_id = uid AND status = 'active'
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
```

Mantém a estrutura corrigida em 0022 (jsonb text-accessors + claims em app_metadata) e o filtro `status='active'` de 0064; apenas insere o passo (2).

---

### 4. Tables UNCHANGED but USED heavily

| Tabela | Como esta feature usa |
|--------|------------------------|
| `auth.users` | signup cria; switch atualiza `user_metadata.active_tenant_id` |
| `tenants` | onboarding cria (nome digitado vira `name`); sidebar lê `name` |
| `user_tenants` | onboarding insere admin; switch valida vínculo ativo |
| `tenant_integrations` | US1 lê para preflight binding; PK + UNIQUE INDEX já existentes garantem 1:1 |
| `tenant_clinic_profile` | onboarding insere lazy (CNPJ/phone); leitura permanece da feature 009 |
| `audit_log` | signup, onboarding (criação tenant), switch, GHL rejection — todos auditados |
| `appointments` | calendário Mês lê com filtros from/to já suportados |

---

### 5. Audit Log usage table

Eventos novos (todos no shape existente de `audit_log`):

| Evento | `entity` | `entity_id` | `field` | `old_value` / `new_value` | `result` |
|--------|----------|-------------|---------|---------------------------|----------|
| Signup | `auth_user` | `<userId>` | `signup` | `null` / `{ email }` | `success` |
| Onboarding (criação de tenant) | `tenants` | `<tenantId>` | `create` | `null` / `{ name, slug }` | `success` |
| Switch de tenant | `session` | `<userId>` | `tenant_switch` | `<tenant_anterior>` / `<novo>` | `success` |
| Tentativa GHL rejeitada (FR-001) | `tenant_integrations` | `<tenantId>` | `connect.rejected:ghl_tenant_already_connected` | `null` / `{ location_id }` | `conflict` |
| Tentativa GHL rejeitada (FR-002) | `tenant_integrations` | `<tenantId ou null>` | `connect.rejected:ghl_location_already_bound` | `null` / `{ location_id, current_owner_tenant_id }` | `conflict` |

Todas com `actor_id`, `ip`, `user_agent` quando disponíveis.

---

## Relationship Diagram (incremento)

```text
auth.users 1—1 user_active_tenant N—1 tenants
auth.users 1—N user_tenants N—1 tenants

(restantes — feature 009)
auth.users 1—1 user_profile
tenants    1—1 tenant_clinic_profile

(GHL 1:1 garantido por:)
tenants    1—1 tenant_integrations(provider='ghl')   (PK)
tenants    1—1 GHL.sub_account                       (UNIQUE INDEX em location_id)
```

---

## Migration Notes

- `0065_active_tenant_and_signup.sql` é puramente aditiva. Reversível em dev (`pnpm supabase:reset`).
- O `auth_hook_custom_claims` é `CREATE OR REPLACE` — idempotente, compatível com replay.
- `create_first_tenant` é nova; sem rollback necessário em dev.
- Nenhum DROP nem ALTER em tabelas de domínio.

---

## Out of Scope (data model)

- Reset/transfer de admin do tenant (mudar quem é o owner) — fora do escopo desta feature.
- Soft-delete de tenants — `tenants.status='suspended'` já existe; gerenciamento dele é fora.
- Tabela de "tenants favoritos" (selecionar mais de uma como rápida) — apenas "última usada" basta.
- Histórico de switches anteriores — apenas a última. Audit log já registra cada switch.
- Métricas de signup (funil) — observabilidade fica fora; o audit serve para reprocessamento futuro.

# Contract — Autorização (overrides) + ações de admin

Feature interna. Os contratos relevantes são a **função de autorização**, o **endpoint de overrides** e as **ações de super-admin**.

## 1. Autorização (`src/lib/auth/rbac.ts`)

```
type Effect = 'grant' | 'deny'
type Override = { action: Action; effect: Effect }

canUser(role: TenantRole, overrides: Override[], action: Action): boolean
// efetivo = (MATRIX[role] ∪ grants) \ denies ; deny prevalece
```

Invariantes:
- `canUser(role, [], a) === can(role, a)` (sem overrides = comportamento atual).
- `deny` de `a` ⇒ `canUser(...) === false`, mesmo que o papel conceda `a`.
- A checagem autoritativa (route handlers `/api/*`, server actions) usa `canUser` com overrides carregados do ator via `getUserOverrides(supabase, tenantId, userId)`.

## 2. Overrides do usuário (admin da clínica)

`POST /api/configuracoes/usuarios/[userId]/permissions` — admin do tenant (ou super-admin).
- Body: `{ changes: Array<{ action: Action; effect: 'grant'|'deny'|'inherit' }>, reason?: string }` (`inherit` remove o override).
- Regras: ator deve ser admin do mesmo tenant; ação protegida (Princípio V) é rejeitada; concessão de ação sensível exige confirmação (a UI já avisou). Audita cada mudança (antes/depois).
- `GET` correlato: lista overrides + efetivo do usuário.

## 3. Ações de super-admin (`/admin`, cross-tenant)

Todas exigem `superAdminUserId()`, recebem `tenantId` alvo explícito, validam escopo e auditam com o `tenant_id` alvo:

| Ação | Efeito |
|------|--------|
| `adminCreateClinicUser(tenantId, ...)` | cria usuário no tenant alvo (reusa createManualUser) |
| `adminSetClinicUserRole(tenantId, userId, role)` | troca papel (respeita enforce_last_admin) |
| `adminSetClinicUserStatus(tenantId, userId, status)` | ativa/desativa (respeita último admin) |
| `adminResetClinicUserPassword(tenantId, userId)` | dispara reset (e-mail/link), sem expor senha |
| `adminUpdateClinicProfile(tenantId, {name,cnpj,phone,...})` | edita tenant_clinic_profile (valida CNPJ) |
| `adminStartImpersonation(tenantId)` / `adminEndImpersonation()` | sessão read-only; bloqueia escrita; banner; audita início/fim |

## 4. Invariantes de segurança (constituição)

- Autorização SEMPRE no servidor; UI nunca é o mecanismo.
- Isolamento por tenant em overrides e em toda ação cross-tenant.
- Ações protegidas (Princípio V) não-overridáveis até decisão/emenda.
- Último admin ativo nunca rebaixado/desativado.
- Impersonação = read-only; toda escrita negada no servidor durante a sessão.
- Tudo auditado (mutações + negações relevantes).

## 5. Não-objetivos

- Sem papéis personalizados (custom roles).
- Sem alteração no conjunto de Actions.
- Sem mexer em módulos/entitlements (feature 042).
- Impersonação com escrita ("assumir controle") = evolução futura.

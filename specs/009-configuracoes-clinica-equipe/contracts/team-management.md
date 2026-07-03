# Contract — Team Management API

**Feature**: 009 | **Group**: gestão de equipe | **Auth**: admin only (all endpoints)

---

## `GET /api/configuracoes/usuarios`

Returns all users linked to the current tenant.

**Response 200**:

```json
{
  "users": [
    {
      "userId": "uuid",
      "email": "user@example.com",
      "fullName": "string | null",
      "avatar": { "path": "...", "signedUrl": "..." } | null,
      "role": "admin" | "financeiro" | "recepcionista" | "profissional_saude",
      "status": "active" | "pending" | "disabled",
      "lastSignInAt": "2026-05-08T12:00:00Z" | null,
      "isSelf": false                    // true for the row representing the requester
    }
  ]
}
```

**Status derivation** (R6):

- `pending` ⇔ `user_tenants.status = 'active'` AND `auth.users.email_confirmed_at IS NULL`
- `active` ⇔ `user_tenants.status = 'active'` AND `auth.users.email_confirmed_at IS NOT NULL`
- `disabled` ⇔ `user_tenants.status = 'disabled'`

**Errors**: `401`, `403`.

---

## `POST /api/configuracoes/usuarios/convite`

Invites a user.

**Request body**:

```ts
{
  email: string,                        // RFC 5322
  role: 'admin' | 'financeiro' | 'recepcionista' | 'profissional_saude'
}
```

**Server flow** (R7):

1. Validate input.
2. Check no active `user_tenants` row exists for `(tenant_id, email)` — if exists → `409 user_already_active`.
3. `supabase.auth.admin.createUser({ email, email_confirm: false })` (idempotent: if email exists, reuse `id`).
4. Insert `user_tenants(user_id, tenant_id, role, status='active')`.
5. `supabase.auth.admin.inviteUserByEmail(email, { redirectTo: '<APP_URL>/welcome' })`.
6. Audit: `entity=user_tenants, field=invite, new_value={ email, role }`.

**Response 201**:

```json
{
  "user": {
    "userId": "uuid",
    "email": "...",
    "role": "...",
    "status": "pending"
  }
}
```

**Errors**:

- `400 invalid_email`, `400 invalid_role`
- `409 user_already_active`
- `502 invite_email_send_failed` — created the row but ViaCEP-style proxy back: `auth.admin.inviteUserByEmail` returned an error. The row is kept; admin can retry via "Reenviar convite" UI (which calls `inviteUserByEmail` again).

---

## `POST /api/configuracoes/usuarios/:userId/reenviar-convite`

Re-sends the invite email for a pending user.

**Server flow**:

1. Validate target row exists with `status='active'` and `email_confirmed_at IS NULL`.
2. Call `auth.admin.inviteUserByEmail` again.
3. Audit: `entity=user_tenants, field=invite, new_value={ email, role, resent: true }`.

**Response 204**.

**Errors**:

- `404 user_not_found`
- `409 not_pending` — user already accepted; nothing to re-send.

---

## `PATCH /api/configuracoes/usuarios/:userId`

Updates a user's role.

**Request body**:

```ts
{
  role: 'admin' | 'financeiro' | 'recepcionista' | 'profissional_saude'
}
```

**Server flow**:

1. Reject if `userId === auth.uid()` AND new role !== `admin` AND `is_last_active_admin(tenant, self)` → `409 last_admin`.
2. `UPDATE user_tenants SET role = :role` for the target row in the active tenant.
3. The `enforce_last_admin` trigger is the second line of defense.
4. Audit: `entity=user_tenants, field=role, old_value=<old>, new_value=<new>`.

**Response 200**: updated user row in the same shape as `GET /usuarios`.

**Errors**:

- `400 invalid_role`
- `404 user_not_found`
- `409 last_admin` — would leave tenant without an admin.

---

## `PATCH /api/configuracoes/usuarios/:userId/status`

Activates or deactivates a user.

**Request body**:

```ts
{
  status: 'active' | 'disabled'
}
```

**Server flow**:

- If `userId === auth.uid()` AND `status === 'disabled'` → reject `409 cannot_disable_self`.
- If `status === 'disabled'` AND target is the last active admin → reject `409 last_admin` (also enforced by trigger).
- `UPDATE user_tenants SET status, disabled_at, disabled_by = (case)` for the row.
- On reactivation (`disabled` → `active`), no email is sent (R6).
- Audit: `entity=user_tenants, field=status, old_value=<old>, new_value=<new>`.

**Response 200**: updated user row.

**Errors**:

- `400 invalid_status`
- `404 user_not_found`
- `409 cannot_disable_self`
- `409 last_admin`

---

## Side effect: JWT custom claims hook

The migration **updates** the `auth.jwt_custom_claims_hook` (created in 0019) to project `tenant_id` and `role` only when `user_tenants.status = 'active'`. Effect: on the first request after a user is disabled, the claims become null and all RLS policies reject access (R15). The middleware's `getUser()` call refreshes the JWT and returns 401 for the disabled session, which the `(dashboard)/layout.tsx` already redirects to `/login`.

No new endpoint required — the kill-switch is purely DB + JWT plumbing.

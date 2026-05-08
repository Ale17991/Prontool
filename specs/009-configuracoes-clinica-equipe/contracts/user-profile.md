# Contract — User Profile API

**Feature**: 009 | **Group**: perfil pessoal | **Auth**: any authenticated role (`admin`, `financeiro`, `recepcionista`, `profissional_saude`)

---

## `GET /api/configuracoes/perfil`

Returns the current user's profile. Lazy-creates the row on first call.

**Response 200**:

```json
{
  "userId": "uuid",
  "email": "user@example.com",        // from auth.users (read-only field)
  "fullName": "string | null",
  "avatar": {
    "path": "tenantId/userId.png",
    "signedUrl": "https://...",
    "uploadedAt": "2026-05-08T12:00:00Z"
  } | null,
  "timezone": "America/Sao_Paulo",
  "updatedAt": "2026-05-08T12:00:00Z"
}
```

**Errors**: `401`.

---

## `PUT /api/configuracoes/perfil`

Updates name and timezone. Email is **NOT** editable here; the field is rejected if present in the body.

**Request body**:

```ts
{
  fullName?: string | null,             // ≤ 200
  timezone?: string                     // must be in Intl.supportedValuesOf('timeZone')
}
```

**Response 200**: same shape as GET.

**Errors**:
- `400 invalid_timezone` — not a recognized IANA TZ.
- `400 unsupported_field` — body contains `email`.
- `401`.

**Audit**: one row per changed field.

---

## `POST /api/configuracoes/perfil/avatar`

Uploads or replaces avatar. Multipart form (`field: avatar`).

**Constraints**:
- `Content-Length` ≤ 2 MB.
- Magic bytes JPG or PNG.
- Path: `{tenant_id}/{user_id}.{jpg|png}` (overwrites previous).

**Response 200**:

```json
{
  "avatar": {
    "path": "tenantId/userId.png",
    "signedUrl": "...",
    "uploadedAt": "2026-05-08T12:00:00Z"
  }
}
```

**Errors**: `400 invalid_image_format`, `413 payload_too_large`, `401`.

---

## `DELETE /api/configuracoes/perfil/avatar`

Removes the current avatar.

**Response 204**.

---

## `POST /api/configuracoes/perfil/senha`

Changes the user's password.

**Request body**:

```ts
{
  currentPassword: string,
  newPassword: string                   // ≥ 8 chars; ≥ 1 letter; ≥ 1 digit
}
```

**Server flow**:
1. Validate `newPassword` strength.
2. Reauthenticate via isolated `signInWithPassword({ email, password: currentPassword })` — if it fails, return `400 invalid_current_password`.
3. Call `supabase.auth.updateUser({ password: newPassword })` on the active session.
4. Insert `audit_log` with `entity=user_profile, field=password` (no plaintext / hash recorded).

**Response 204**.

**Errors**:
- `400 invalid_current_password`
- `400 weak_password` — payload includes `details: { reason: 'too_short' | 'missing_letter' | 'missing_digit' }`
- `400 password_mismatch` — IF the front sends a confirm field and they differ (server is also defensive).
- `401`.

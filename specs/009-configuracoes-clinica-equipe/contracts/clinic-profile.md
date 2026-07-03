# Contract — Clinic Profile API

**Feature**: 009 | **Group**: configurações da clínica | **Auth**: admin only

All endpoints require an authenticated session and `requireRole('admin')`. Requests/responses are JSON unless noted.

---

## `GET /api/configuracoes/clinica`

Returns the clinic profile of the active tenant. If the row does not exist yet, the handler creates it lazily and returns the empty shape (all fields `null` except `tenant_id`).

**Response 200**:

```json
{
  "tenantId": "uuid",
  "logo": {
    "path": "uuid/logo.png",
    "signedUrl": "https://...?token=...",
    "uploadedAt": "2026-05-08T12:00:00Z"
  } | null,
  "corporateName": "string | null",
  "cnpj": "14-digit string | null",
  "phone": "string | null",
  "email": "string | null",
  "address": {
    "cep": "8-digit string | null",
    "street": "string | null",
    "number": "string | null",
    "complement": "string | null",
    "neighborhood": "string | null",
    "city": "string | null",
    "uf": "2-letter string | null"
  },
  "techResponsible": {
    "name": "string | null",
    "council": "string | null",
    "registration": "string | null"
  },
  "updatedAt": "2026-05-08T12:00:00Z"
}
```

**Errors**:

- `401` not authenticated
- `403` not admin

---

## `PUT /api/configuracoes/clinica`

Updates the clinic profile in a single call. Server validates each field; partial updates allowed (any field omitted is left unchanged). Each modified field generates one `audit_log` row.

**Request body** (Zod):

```ts
{
  corporateName?: string | null,        // ≤ 200
  cnpj?: string | null,                 // 14 digits, valid check digits
  phone?: string | null,                // ≤ 20 digits
  email?: string | null,                // RFC 5322 minimal
  address?: {
    cep?: string | null,                // 8 digits
    street?: string | null,
    number?: string | null,
    complement?: string | null,
    neighborhood?: string | null,
    city?: string | null,
    uf?: string | null                  // ∈ 27 brazilian state codes
  },
  techResponsible?: {
    name?: string | null,
    council?: string | null,            // ∈ ['CRM','CRO','CREFITO','CRP','CRN','COREN','CRF','CRBM','CRESS', …]
    registration?: string | null
  }
}
```

**Response 200**: same shape as `GET`.

**Errors**:

- `400 invalid_cnpj` — CNPJ digits do not validate.
- `400 invalid_field` — any field fails Zod schema; payload includes `details: { field, message }`.
- `401`, `403` as above.

---

## `POST /api/configuracoes/clinica/logo`

Uploads or replaces the clinic logo. Multipart form (`field name: logo`) with the binary file.

**Constraints**:

- `Content-Length` ≤ 2 MB (rejected with 413 otherwise).
- File MUST start with JPG (`FF D8 FF`) or PNG (`89 50 4E 47 0D 0A 1A 0A`) magic bytes — checked server-side.
- Path stored: `{tenant_id}/logo.{jpg|png}` (overwrites previous logo).

**Response 200**:

```json
{
  "logo": {
    "path": "uuid/logo.png",
    "signedUrl": "...",
    "uploadedAt": "2026-05-08T12:00:00Z"
  }
}
```

**Errors**:

- `400 invalid_image_format` — magic bytes do not match.
- `413 payload_too_large` — file > 2 MB.

---

## `DELETE /api/configuracoes/clinica/logo`

Removes the current logo (`storage.objects` row + `tenant_clinic_profile.logo_path = NULL`).

**Response 204**.

**Audit**: `entity=tenant_clinic_profile, field=logo, old_value=<path>, new_value=null`.

---

## `GET /api/configuracoes/cep/:cep`

ViaCEP proxy. `cep` is 8 digits, no mask. Auth required (any role) — the endpoint is internal-only.

**Response 200**:

```json
{
  "ok": true,
  "address": {
    "cep": "01310100",
    "street": "Avenida Paulista",
    "neighborhood": "Bela Vista",
    "city": "São Paulo",
    "uf": "SP"
  }
}
```

**Response 200 with `ok: false`** (CEP not found, ViaCEP unreachable, timeout):

```json
{
  "ok": false,
  "reason": "not_found" | "timeout" | "unavailable"
}
```

**Cache**: `Cache-Control: public, s-maxage=86400, stale-while-revalidate=604800`.

**Errors**:

- `400 invalid_cep` — not 8 digits.
- `401` — not authenticated.

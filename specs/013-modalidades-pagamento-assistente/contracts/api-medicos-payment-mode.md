# API Contract — Modalidade de pagamento do profissional

Estende as rotas existentes em `/api/medicos`. Mantém compatibilidade total com clients legados.

---

## 1. `POST /api/medicos` (alterada)

**RBAC**: `admin` apenas (sem mudança).

**Request body** (Zod schema):

```ts
{
  full_name: string (1..200),
  crm: string (1..50),
  external_identifier?: string | null,
  role?: string | null,
  specialty?: string | null,
  council_name?: string | null,
  council_number?: string | null,

  // Modalidade de pagamento — NOVO bloco. Default 'comissionado' se ausente
  // (cobre clients legados que não enviam).
  payment_mode?: 'comissionado' | 'fixo' | 'liberal' = 'comissionado',

  // Comissionado (obrigatório quando payment_mode='comissionado'):
  initial_percentage_bps?: number (0..10000),
  initial_valid_from?: string (YYYY-MM-DD),
  initial_reason?: string (3..500),

  // Fixo (obrigatório quando payment_mode='fixo'):
  monthly_amount_cents?: number > 0,
  billing_day?: number (1..28),

  // Liberal (obrigatório quando payment_mode='liberal'):
  liberal_default_cents?: number > 0,
}
```

**Validação cruzada** (Zod refine):

- `payment_mode='comissionado'` ⇒ `initial_percentage_bps`, `initial_valid_from`, `initial_reason` obrigatórios; outros mutuamente exclusivos null.
- `payment_mode='fixo'` ⇒ `monthly_amount_cents`, `billing_day` obrigatórios; `initial_reason` obrigatório; outros null.
- `payment_mode='liberal'` ⇒ `liberal_default_cents` obrigatório; `initial_reason` obrigatório; outros null.

**Server flow**:

1. `requireRole(['admin'])`.
2. INSERT em `doctors` com `payment_mode`.
3. INSERT em `doctor_commission_history` se modo='comissionado' (preserva fluxo atual para frozen_commission_bps).
4. INSERT em `doctor_payment_terms_history` via RPC `record_payment_terms_change` (atomico — uma transação).

**Response 201**:

```json
{
  "id": "<uuid>",
  "full_name": "Dr. Foo",
  "crm": "12345",
  "payment_mode": "fixo",
  "current_monthly_amount_cents": 800000,
  "current_billing_day": 5,
  "current_percentage_bps": null,
  "current_liberal_default_cents": null,
  "active": true,
  "created_at": "2026-05-14T13:21:00Z"
}
```

**Errors**:

- `400 INVALID_BODY` — campos inconsistentes com `payment_mode`.
- `403 FORBIDDEN` — não-admin.
- `409 DOCTOR_CRM_DUPLICATE` — CRM já existe no tenant.

---

## 2. `GET /api/medicos` (alterada — output estendido)

**RBAC**: `admin`, `financeiro`, `recepcionista`, `profissional_saude` (sem mudança).

**Query**: `?include_inactive=true|false` (sem mudança).

**Response 200** (cada item ganha campos `payment_mode` + parâmetros vigentes da `doctor_payment_terms_current`):

```json
{
  "items": [
    {
      "id": "<uuid>",
      "full_name": "Dr. Foo",
      "crm": "12345",
      "role": "Médico",
      "specialty": "Anestesiologia",
      "active": true,
      "payment_mode": "liberal",
      "current_percentage_bps": null,
      "current_monthly_amount_cents": null,
      "current_billing_day": null,
      "current_liberal_default_cents": 35000,
      "current_valid_from": "2026-05-14",
      "created_at": "2024-08-12T..."
    }
  ]
}
```

---

## 3. `PATCH /api/medicos/[id]` (alterada — aceita mudança de modalidade)

**RBAC**: `admin` apenas para mudança de `payment_mode`; demais campos seguem RBAC atual.

**Request body** — qualquer subset:

```ts
{
  full_name?: string,
  active?: boolean,
  role?: string | null,
  specialty?: string | null,
  council_name?: string | null,
  council_number?: string | null,

  // Bloco modalidade — se presente, exige reason e gera nova versão em history.
  payment_mode_change?: {
    payment_mode: 'comissionado' | 'fixo' | 'liberal',
    percentage_bps?: number,
    monthly_amount_cents?: number,
    billing_day?: number,
    liberal_default_cents?: number,
    valid_from: string (YYYY-MM-DD), // <= hoje
    reason: string (3..500),
  }
}
```

**Server flow**:

1. `requireRole(['admin'])` se body tem `payment_mode_change`; senão herda RBAC anterior.
2. Se `payment_mode_change`: invoca RPC `record_payment_terms_change(...)` (única transação, INSERT history + UPDATE doctors.payment_mode).
3. Demais campos: UPDATE direto em `doctors`.

**Response 200**:

```json
{ "ok": true, "payment_mode": "fixo" }
```

**Errors**:

- `400 INVALID_BODY` — campos inconsistentes com `payment_mode`.
- `403 FORBIDDEN_ROLE` — não-admin tentando trocar modalidade.
- `404 DOCTOR_NOT_FOUND` — id inexistente no tenant.
- `409 VALID_FROM_FUTURE` — `valid_from > CURRENT_DATE` rejeitado (MVP sem agendamento de futuro).

---

## 4. `GET /api/medicos/[id]/payment-terms` — NOVO

Retorna o histórico de modalidades/parâmetros do profissional.

**RBAC**: `admin`, `financeiro` (audit + relatórios).

**Response 200**:

```json
{
  "doctor_id": "<uuid>",
  "current": {
    "payment_mode": "fixo",
    "monthly_amount_cents": 800000,
    "billing_day": 5,
    "valid_from": "2026-04-01"
  },
  "history": [
    {
      "id": "<uuid>",
      "payment_mode": "fixo",
      "monthly_amount_cents": 800000,
      "billing_day": 5,
      "valid_from": "2026-04-01",
      "reason": "Mudança para regime CLT",
      "created_by": "<uuid>",
      "created_at": "2026-04-01T09:12:00Z"
    },
    {
      "id": "<uuid>",
      "payment_mode": "comissionado",
      "percentage_bps": 4000,
      "valid_from": "2024-08-12",
      "reason": "Backfill 0084 — preserva modalidade comissionado existente",
      "created_by": "00000000-0000-0000-0000-000000000000",
      "created_at": "..."
    }
  ]
}
```

---

## 5. Auditoria

Todas as mudanças geram entrada em `audit_log` (Constitution II):

| Ação                                           | entity                 | field                  | new_value                                    |
| ---------------------------------------------- | ---------------------- | ---------------------- | -------------------------------------------- |
| Criar profissional com modalidade              | `doctor_payment_terms` | `version_created`      | `{payment_mode, params, valid_from, reason}` |
| Mudar modalidade (PATCH `payment_mode_change`) | `doctor_payment_terms` | `version_created`      | `{payment_mode, params, valid_from, reason}` |
| (espelho automático)                           | `doctors`              | `payment_mode_changed` | `{previous_mode, new_mode}`                  |
| Tentativa de mudança por não-admin             | `doctors`              | `auth_denied`          | `{requested_role: 'admin', actual_role}`     |

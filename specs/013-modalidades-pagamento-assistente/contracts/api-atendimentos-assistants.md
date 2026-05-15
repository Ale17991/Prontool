# API Contract — Assistentes em atendimento

Estende rotas existentes de atendimento e adiciona endpoints para gerenciar assistentes em atendimentos já salvos.

---

## 1. `POST /api/atendimentos/manual` (alterada)

Aceita lista opcional de assistentes no mesmo payload.

**RBAC**: `admin`, `recepcionista` (sem mudança).

**Request body** — campos novos destacados:

```ts
{
  patient_id: string (UUID),
  doctor_id: string (UUID), // MUST ter payment_mode IN ('comissionado','fixo'); 'liberal' rejeitado
  procedures: [...], // existente
  appointment_at: string (ISO),
  duration_minutes?: number,
  add_to_treatment_plan?: boolean,

  // Materiais (existente)
  materiais?: [...],

  // ★ NOVO — assistentes (opcional)
  assistants?: Array<{
    assistant_doctor_id: string (UUID),
    amount_cents: number (> 0, < 100_000_000), // valor congelado para este atendimento
  }>,
}
```

**Validação**:

- `doctor_id` MUST corresponder a um doctor com `payment_mode IN ('comissionado','fixo')`. Se Liberal: `400 LIBERAL_AS_PRINCIPAL`.
- Cada `assistant_doctor_id` MUST ter `payment_mode='liberal'` no momento do submit (verificado pelo trigger `check_assistant_doctor_is_liberal`). Se não: `400 ASSISTANT_NOT_LIBERAL`.
- `assistant_doctor_id` único na array (lado server) — duplicata: `400 DUPLICATE_ASSISTANT`.
- Cada `amount_cents > 0`.

**Server flow**:

1. `requireRole(['admin','recepcionista'])`.
2. Cria appointment via fluxo atual (preserva `frozen_amount_cents`, `frozen_commission_bps`, materiais).
3. Para cada item em `assistants[]`, chama RPC `attach_assistant_to_appointment(appointment_id, assistant_doctor_id, amount_cents, actor)` na mesma transação SQL.
4. Audit log automático via triggers (`audit_appointment_assistant_change`).

**Response 201**:

```json
{
  "appointment_id": "<uuid>",
  "assistants_count": 2,
  "assistants": [
    { "id": "<uuid>", "assistant_doctor_id": "<uuid>", "frozen_amount_cents": 35000 },
    { "id": "<uuid>", "assistant_doctor_id": "<uuid>", "frozen_amount_cents": 20000 }
  ]
}
```

**Errors novos**:

- `400 LIBERAL_AS_PRINCIPAL`
- `400 ASSISTANT_NOT_LIBERAL`
- `400 DUPLICATE_ASSISTANT`
- `400 INVALID_ASSISTANT_AMOUNT`

---

## 2. `GET /api/atendimentos/[id]` (alterada — output)

Inclui `assistants` na resposta.

**Response 200** — campo novo:

```json
{
  "id": "<uuid>",
  "patient": { ... },
  "doctor": { "id": "...", "full_name": "...", "payment_mode": "comissionado" },
  "procedures": [ ... ],
  "materiais": [ ... ],

  "assistants": [
    {
      "id": "<uuid>",
      "doctor": { "id": "...", "full_name": "Anestesista X", "payment_mode": "liberal" },
      "frozen_amount_cents": 35000,
      "created_at": "..."
    }
  ],
  "removed_assistants_count": 1
}
```

`removed_assistants_count` informa quantos assistentes foram removidos historicamente (útil para audit visual). Os removidos NÃO aparecem em `assistants` (somente ativos).

---

## 3. `POST /api/atendimentos/[id]/assistants` — NOVO

Adiciona um assistente em atendimento já existente.

**RBAC**: `admin`, `recepcionista`.

**Request body**:

```ts
{
  assistant_doctor_id: string (UUID),
  amount_cents: number (> 0)
}
```

**Server flow**:

1. `requireRole(['admin','recepcionista'])`.
2. Bloqueia se atendimento estornado → `409 APPOINTMENT_REVERSED`.
3. Bloqueia se já existe ativo para o mesmo `(appointment_id, assistant_doctor_id)` → `409 DUPLICATE_ACTIVE_ASSISTANT` (capturado do unique parcial).
4. RPC `attach_assistant_to_appointment(...)`.

**Response 201**:

```json
{ "id": "<uuid>", "frozen_amount_cents": 35000 }
```

**Errors**:

- `400 ASSISTANT_NOT_LIBERAL`
- `404 APPOINTMENT_NOT_FOUND`
- `409 APPOINTMENT_REVERSED`
- `409 DUPLICATE_ACTIVE_ASSISTANT`

---

## 4. `PATCH /api/atendimentos/[id]/assistants/[assistantId]` — NOVO

Remove (soft) um assistente — seta `removed_at`/`removed_by`.

**RBAC**: `admin`, `recepcionista`.

**Request body**: `{}` (vazio — única ação suportada é remover; representada como PATCH semântico).

**Server flow**:

1. `requireRole(['admin','recepcionista'])`.
2. RPC `remove_appointment_assistant(p_id, p_actor)`.
3. Erro `ASSISTANT_ALREADY_REMOVED` → `409`.

**Response 200**:

```json
{ "ok": true, "removed_at": "2026-05-14T14:21:00Z" }
```

**Errors**:

- `404 ASSISTANT_NOT_FOUND` (inclui tenant mismatch — mascarado).
- `409 ASSISTANT_ALREADY_REMOVED`.

---

## 5. Auditoria

| Ação                                              | entity                  | field      | new_value                                        |
| ------------------------------------------------- | ----------------------- | ---------- | ------------------------------------------------ |
| Adicionar assistente (POST manual ou POST direto) | `appointment_assistants`| `added`    | `{appointment_id, assistant_doctor_id, amount}`  |
| Remover assistente (PATCH)                        | `appointment_assistants`| `removed`  | `{removed_at, removed_by}`                       |
| Tentativa de adicionar não-liberal                | `appointment_assistants`| `validation_denied` | `{reason: 'ASSISTANT_NOT_LIBERAL', doctor_id}` |
| Tentativa de criar atendimento com Liberal como principal | `appointments`  | `validation_denied` | `{reason: 'LIBERAL_AS_PRINCIPAL', doctor_id}` |

# Contract: `POST /api/atendimentos/manual`

Cria um registro de atendimento realizado, sem depender de webhook de nenhum provider.

## Auth

- JWT Supabase obrigatório (cookie httpOnly).
- `requireRole(['admin', 'recepcionista'])`.
- `tenant_id` derivado do claim da sessão.

## Request

`POST /api/atendimentos/manual`  
`Content-Type: application/json`

```json
{
  "patient_id": "3b1c3c88-4e76-4f1c-95e8-8e33b9ab1d09",
  "doctor_id": "9f6e1d2a-7b33-4f5b-a0e4-12a7e0b33c91",
  "procedure_id": "1d8a55f3-3c8b-4a19-bf25-4b7a8c221000",
  "plan_id": "6f9a1e0c-2c8f-4e41-bb6d-9b9f3a80a111",
  "appointment_at": "2026-04-24T17:30:00Z",
  "amount_cents_override": 18000,
  "observacoes": "Paciente retornou para reavaliação pós-cirúrgica."
}
```

### Schema (Zod)

```ts
z.object({
  patient_id: z.string().uuid(),
  doctor_id: z.string().uuid(),
  procedure_id: z.string().uuid(),
  plan_id: z.string().uuid(),
  appointment_at: z.string().datetime(),
  amount_cents_override: z.number().int().min(0).optional(),
  observacoes: z.string().trim().max(500).optional(),
})
```

### Business rules

- `appointment_at` não pode ser futuro. 400 `APPOINTMENT_IN_FUTURE` se `> now()`.
- `patient_id`, `doctor_id`, `procedure_id`, `plan_id` devem pertencer ao mesmo `tenant_id`.
- `procedure_id` vigente no catálogo TUSS (rejeita retirado → 422 `TUSS_CODE_RETIRED`).
- `resolvePrice(plan_id, procedure_id, appointment_at)` ou 422 `PRICE_NOT_FOUND`.
- `resolveCommission(doctor_id, procedure_id, appointment_at)` ou 422 `COMMISSION_NOT_FOUND`.

## Response 201

```json
{
  "appointment_id": "abc12345-6789-4def-0123-456789abcdef",
  "source": "manual",
  "frozen_amount_cents": 18000,
  "frozen_commission_bps": 3000,
  "appointment_at": "2026-04-24T17:30:00Z",
  "integrations_dispatched": [
    { "provider": "ghl", "ok": true, "detail": "note_created" },
    { "provider": "generic_webhook", "ok": false, "detail": "timeout" }
  ]
}
```

- `integrations_dispatched` é **sempre um array** (possivelmente vazio em modo standalone). Para cada provider ativo do tenant, indica se o adapter processou com sucesso.
- Array vazio ⇒ tenant standalone (nenhuma integração ativa).
- Falha de adapter **não** retorna 5xx — o atendimento foi criado com sucesso. Frontend pode inspecionar o array para mostrar avisos.

## Response 400 / 404 / 422

| Status | Code |
|--------|------|
| 400 | `INVALID_BODY` |
| 400 | `APPOINTMENT_IN_FUTURE` |
| 401 | `UNAUTHENTICATED` |
| 403 | `FORBIDDEN` |
| 404 | `PATIENT_NOT_FOUND` / `DOCTOR_NOT_FOUND` / `PROCEDURE_NOT_FOUND` / `PLAN_NOT_FOUND` |
| 422 | `TUSS_CODE_RETIRED` |
| 422 | `PRICE_NOT_FOUND` |
| 422 | `COMMISSION_NOT_FOUND` |
| 500 | `INTERNAL_ERROR` |

```json
{ "error": { "code": "APPOINTMENT_IN_FUTURE", "message": "Atendimento não pode estar no futuro" } }
```

## Side effects

1. INSERT em `appointments` (`source='manual'`, append-only — Principle I).
2. Se `amount_cents_override` presente → `audit_log` `event_type='appointment.price_override'` (valor vigente vs aplicado).
3. **Event bus publish** de `appointment.created` → dispatcher chama `adapter.handleDomainEvent()` para cada integração ativa via `Promise.allSettled`:
   - Timeout individual por adapter: 5 s.
   - Timeout agregado: 8 s (request não passa disso mesmo que algum adapter trave).
   - Adapter com sucesso → `integrations_dispatched[i].ok = true`.
   - Adapter com falha → `integrations_dispatched[i].ok = false`, alerta `integration_sync_failed` criado com `provider` + `action` + `failure_reason` em `detail`.
4. Modo standalone (nenhum adapter habilitado) ⇒ event bus executa e encontra lista vazia; zero chamadas externas, zero logs de "integração pendente", `integrations_dispatched = []`.

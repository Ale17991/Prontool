# Contract — POST `/api/lembretes/[id]/reenviar`

**Localização**: `src/app/api/lembretes/[id]/reenviar/route.ts`.
**Acesso**: autenticado com role `admin` ou `recepcionista` (FR-018, clarificação Q2).

---

## Request

```
POST /api/lembretes/{appointmentId}/reenviar
Cookie: <session>
```

Path param `id` é o **`appointmentId`** (não o `reminder.id`). Convenção: reenviar é uma ação sobre o agendamento, não sobre um registro específico de envio.

Sem corpo.

## Response

### 200 OK — sucesso

```json
{
  "reminderId": "uuid-do-registro-novo",
  "status": "sent" | "failed",
  "providerMessageId": "...",
  "errorMessage": null
}
```

Sempre 200 quando o pipeline conseguiu rodar — `status` indica se o envio efetivo foi sucesso ou falha.

### 401 Unauthorized — não autenticado

```json
{ "error": "UNAUTHORIZED" }
```

### 403 Forbidden — sem permissão

```json
{ "error": "FORBIDDEN" }
```

### 404 Not Found — appointment não pertence ao tenant ou não existe

```json
{ "error": "APPOINTMENT_NOT_FOUND" }
```

### 422 Unprocessable — agendamento estornado ou paciente opt-out

```json
{
  "error": "NOT_ELIGIBLE",
  "code": "REVERSED" | "PATIENT_OPT_OUT" | "NO_EMAIL"
}
```

(Reenvio manual ainda valida elegibilidade básica — admin não pode forçar envio para paciente que recusou explicitamente.)

### 500 Internal Server Error

```json
{ "error": "INTERNAL_ERROR" }
```

---

## Server-side flow

1. `requireRole(['admin', 'recepcionista'])` — falha → 401 ou 403 conforme natureza.
2. Resolver `appointment` pelo `id` filtrado por `tenant_id = session.tenantId` (defense-in-depth + RLS). Não encontrado → 404.
3. Validar elegibilidade:
   - Paciente tem email? Senão → 422 `NO_EMAIL`.
   - Paciente `reminders_opt_in = TRUE`? Senão → 422 `PATIENT_OPT_OUT`.
   - Agendamento NÃO está estornado? Senão → 422 `REVERSED`.
4. Resolver `doctor.full_name`, `procedure.display_name`, `patient.full_name`, `patient.email` (dados atuais — Q4).
5. Renderizar template (mesmo helper do cron).
6. INSERT `appointment_reminders` com:
   - `scheduled_offset_hours = -1` (sentinela para "manual fora do ciclo")
   - `is_manual = TRUE` (NÃO entra na UNIQUE de idempotência — admin pode reenviar quantas vezes quiser)
   - `status = 'queued'`
7. Chamar `sendReminderEmail` (Resend client).
8. UPDATE registro: `status='sent', sent_at=now(), provider_message_id=<id>` OU `status='failed', error=<msg>`.
9. Audit já capturado pelo trigger.
10. Retornar JSON com `reminderId`, `status`, `providerMessageId`, `errorMessage`.

---

## Observability

- Pino info `{ msg: 'manual-resend-start', appointmentId, actorUserId }`.
- Pino info `{ msg: 'manual-resend-done', appointmentId, reminderId, status }`.
- Falha de envio loga `{ msg: 'manual-resend-failed', appointmentId, errorCode }` (sem email do paciente).

---

## Audit

- Trigger em `appointment_reminders` registra INSERT (status=queued) + UPDATE (status→sent/failed).
- Audit já carrega `actor_id` via `session_uuid('app.actor_id')` definido no middleware da requisição (pattern existente em outras rotas).

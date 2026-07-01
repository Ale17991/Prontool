# Contract — POST `/api/public/booking/[slug]/create`

**Localização**: `src/app/api/public/booking/[slug]/create/route.ts`.
**Acesso**: público (sem auth). Rate-limited. Exige Turnstile token válido.

---

## Request

```
POST /api/public/booking/[slug]/create
Content-Type: application/json
```

### Path params

| Param  | Tipo   | Validação                   |
| ------ | ------ | --------------------------- |
| `slug` | string | `^[a-z0-9][a-z0-9-]{2,31}$` |

### Body (Zod schema)

```typescript
{
  doctor_id: string() // UUID
  procedure_id: string() // UUID
  slot_start: string() // ISO 8601 UTC
  patient: {
    full_name: string().min(3).max(120)
    cpf: string()
      .regex(/^\d{11}$/)
      .optional() // só dígitos
    email: string().email().max(120)
    phone: string().min(8).max(20) // formato livre, validação básica
    birth_date: string().regex(/^\d{4}-\d{2}-\d{2}$/) // ISO date
  }
  lgpd_consent: literal(true) // booleano que MUST ser true
  turnstile_token: string().min(20).max(2048)
}
```

### Headers

- `X-Forwarded-For` ou `X-Real-IP`: usado para extrair IP → hash.
- `User-Agent`: armazenado em audit_log.

---

## Response

### 201 Created — sucesso

```json
{
  "appointmentId": "uuid",
  "cancelToken": "base64url-raw",
  "redirectUrl": "/agendar/[slug]/sucesso/{cancelToken}",
  "scheduledAt": "2026-05-20T11:00:00Z",
  "timezone": "America/Sao_Paulo"
}
```

- `cancelToken`: token raw (32 bytes base64url). **Único momento** em que aparece na rede. Server armazena apenas o hash. Client redireciona para `redirectUrl` que contém o token e mostra link "Cancelar" baseado nele.

### 400 Bad Request — payload inválido

```json
{
  "error": "INVALID_PAYLOAD",
  "details": [{ "field": "patient.email", "message": "Invalid email" }]
}
```

Erros Zod mapeados para field paths legíveis.

### 403 Forbidden — Turnstile inválido

```json
{ "error": "CAPTCHA_FAILED" }
```

Não revela motivo específico (token expirado vs forjado vs hostname mismatch). Audit log registra detalhe.

### 404 Not Found — slug não existe ou disabled

```json
{ "error": "TENANT_NOT_FOUND_OR_DISABLED" }
```

### 409 Conflict — slot já ocupado (race condition)

```json
{
  "error": "SLOT_NO_LONGER_AVAILABLE",
  "message": "Esse horário acabou de ser ocupado. Por favor, escolha outro."
}
```

UI deve voltar para tela de seleção de horários preservando o formulário preenchido.

### 422 Unprocessable Entity — validações de negócio

```json
{
  "error": "VALIDATION_FAILED",
  "code": "OUT_OF_BOOKING_WINDOW" | "DOCTOR_PROCEDURE_NOT_PUBLISHED" | "INVALID_SLOT_START",
  "message": "..."
}
```

- `OUT_OF_BOOKING_WINDOW`: `slot_start` fora de `[now + min_hours, now + max_days]`.
- `DOCTOR_PROCEDURE_NOT_PUBLISHED`: combinação não está em `public_booking_doctor_procedures`.
- `INVALID_SLOT_START`: `slot_start` não está alinhado à grade de slots (não é multiplo de duration_minutes da janela do médico).

### 429 Too Many Requests — rate limit

```json
{ "error": "RATE_LIMITED", "retryAfter": 3600 }
```

Limite mais agressivo que `slots`: 3 submits válidos/hora por IP+tenant.

### 500 Internal Server Error

Genérico. Erro completo só em logs.

---

## Server-side flow (transação)

1. **Validar payload** com Zod. Falha → 400.
2. **Verificar `lgpd_consent === true`**. Falha → 400.
3. **Hash IP** = sha256(ip + ':' + slug).
4. **Rate limit submit**: count em `public_booking_rate_limits` WHERE ip_hash + action='submit' + created_at > now() - 1h. Se ≥3 → 429.
5. **Verify Turnstile**: POST para `https://challenges.cloudflare.com/turnstile/v0/siteverify` com `secret` (env) + `response` (token). Se `success!==true` → 403.
6. **Resolve tenant**: `public_booking_resolve_slug(slug)`. Se NULL → 404.
7. **Validar combinação publicada**: SELECT `(doctor_id, procedure_id)` em `public_booking_doctor_procedures` WHERE tenant. Se ausente → 422 `DOCTOR_PROCEDURE_NOT_PUBLISHED`.
8. **Validar janela**: `slot_start` deve estar em `[now + min_hours, now + max_days]`. Falha → 422 `OUT_OF_BOOKING_WINDOW`.
9. **Verificar slot livre** (anti-race): chamar `public_booking_slots(...)` para confirmar que slot ainda está disponível. Não confiar — apenas validação anterior, real garantia é o EXCLUDE constraint no INSERT.
10. **Iniciar transação Postgres**.
11. **INSERT rate_limit** action='submit'.
12. **Resolve paciente**: chamar `public_booking_find_patient_by_cpf` se CPF fornecido.
    - Match: `UPDATE patients SET email_enc=..., phone_enc=...` se diferentes (FR-011a), audit a mudança.
    - No match: `createPatient` existente (mesma criptografia).
13. **INSERT appointment**: `createAppointment` existente com:
    - `tenant_id` do tenant resolvido (NÃO do client)
    - `patient_id` do passo 12
    - `doctor_id`, `procedure_id` do body
    - `appointment_at` = `slot_start`
    - `status='agendado'`
    - `actor_user_id=NULL`
14. **Trigger automaticamente** popula `appointment_slot_locks`. Se EXCLUDE viola → ROLLBACK → retornar 409 `SLOT_NO_LONGER_AVAILABLE`.
15. **Gerar token**: `crypto.randomBytes(32).toString('base64url')`. Hash via SHA-256.
16. **INSERT public_booking_tokens** com hash, action='cancel', expires_at=now()+30d.
17. **INSERT audit_log** via `log_audit_event`: entity='appointment', entity_id=appointmentId, event_type='public_booking_created', actor=NULL, actor_label='public_booking', detail JSONB com {ip_hash, slug, doctor_id, procedure_id}.
18. **COMMIT transação**.
19. **Pós-commit (fire-and-forget)**:
    - INSERT em `notifications` para cada admin do tenant (type='public_booking', reference_id=appointmentId).
    - `sendBookingConfirmationEmail` para paciente (com .ics).
    - `sendAdminBookingNotificationEmail` para admins.
    - Erros nesses passos NÃO falham a request — appointment já foi persistido. Logar via pino.
20. **Retornar 201** com `cancelToken` raw + `redirectUrl`.

---

## Idempotência

**Não há proteção idempotente nativa**. Se cliente clicar 2x submit antes do response:

- Primeira request: cria appointment + slot lock.
- Segunda request: EXCLUDE viola → 409. Cliente vê erro "Slot ocupado", mas a primeira já completou.

**Mitigação client-side**: desabilitar botão "Confirmar" no `onSubmit`, mostrar spinner. Server não confia mas pelo menos UX evita.

**Futuro** (fase 2 se necessário): adicionar `Idempotency-Key` header com UUID gerado no client → cache server-side de 5min retornando mesma response.

---

## Acceptance behaviors

1. Payload válido + Turnstile válido + tenant válido + slot livre → 201 com token + email enviado.
2. CPF match em paciente existente → 201 + reaproveita paciente + atualiza contato + audit.
3. CPF não fornecido → 201 + cria paciente novo (cpf NULL).
4. `lgpd_consent=false` → 400.
5. Turnstile expirado → 403.
6. Slot ocupado entre seleção e submit → 409 com mensagem amigável.
7. Slot fora da janela → 422.
8. 4ª submit em 1 hora do mesmo IP → 429.
9. Tentativa de manipular `tenant_id` ou `slot_start` via console → server valida e rejeita.
10. Race condition: 2 submits paralelos para mesmo slot → 1 sucesso, 1 conflito (provado por `public-booking-slot-collision.test.ts`).

# Contract — POST `/api/public/booking/cancel/[token]`

**Localização**: `src/app/api/public/booking/cancel/[token]/route.ts`.
**Acesso**: público (sem auth). **POST obrigatório** — GET retorna a página de confirmação intermediária mas NÃO executa o cancelamento (anti-preview).

---

## Request

```
POST /api/public/booking/cancel/[token]
Content-Type: application/json
```

(body vazio — token está na URL)

### Path params

| Param | Tipo | Validação |
|---|---|---|
| `token` | string | base64url, 32 bytes (43 chars sem padding) |

---

## Response

### 200 OK — sucesso

```json
{
  "appointmentId": "uuid",
  "scheduledAt": "2026-05-20T11:00:00Z",
  "doctorName": "Dr. João",
  "procedureName": "Consulta clínica",
  "cancelledAt": "2026-05-19T16:23:00Z"
}
```

UI mostra mensagem de sucesso usando esses dados.

### 410 Gone — token expirado, usado, ou inválido

```json
{ "error": "TOKEN_NOT_VALID" }
```

**Importante**: **não distingue** entre "expirado", "já usado", "inválido" ou "appointment não encontrado". Mesma resposta para evitar enumeration attack. Audit log registra detalhe.

### 422 Unprocessable Entity — cancelamento bloqueado por política

```json
{
  "error": "CANCEL_WINDOW_EXPIRED",
  "message": "Cancelamento online disponível até 6h antes da consulta. Entre em contato com a clínica.",
  "clinicPhone": "(11) 99999-9999",
  "clinicEmail": "contato@clinica.com.br"
}
```

Retornado quando `appointment_at - now() < cancel_min_hours horas`. Frontend mostra dados de contato para o paciente saber como cancelar manualmente.

### 429 Too Many Requests

```json
{ "error": "RATE_LIMITED", "retryAfter": 60 }
```

Limite: 5 tentativas de cancelar/hora por IP — protege contra brute force de tokens.

### 500 Internal Server Error

---

## Server-side flow

1. **Validar formato do token** (base64url, length esperada). Falha → 410 (genérico).
2. **Calcular hash**: `sha256(token raw)`.
3. **Rate limit**: count em `public_booking_rate_limits` WHERE ip_hash + action='cancel' (novo action enum: adicionar 'cancel'). Se >5/h → 429.
4. **Buscar token**: `SELECT * FROM public_booking_tokens WHERE token_hash = $1 AND action = 'cancel'`. Se NULL ou used_at IS NOT NULL ou expires_at < now() → 410.
5. **Validação constant-time**: usar `crypto.timingSafeEqual(buf_input_hash, buf_db_hash)` em vez de igualdade direta no query — proteção contra timing attack (defesa em profundidade — Postgres já é constant-time mas reforça em app).
6. **Buscar appointment**: `SELECT * FROM appointments WHERE id = $1`. Se status já cancelado/estornado → 410 (token usado conceitualmente).
7. **Verificar janela de cancelamento**: `appointment_at - now() ≥ cancel_min_hours horas` (lê política do tenant). Se não → 422 `CANCEL_WINDOW_EXPIRED` + dados de contato.
8. **Iniciar transação**.
9. **UPDATE appointments SET status='cancelado' WHERE id=$1**.
10. **Liberar slot lock**: ver research §13. Provavelmente `DELETE FROM appointment_slot_locks WHERE appointment_id=$1` ou alternativa via coluna `released_at` se trigger conflitante. **Decidir durante implementação**.
11. **UPDATE public_booking_tokens SET used_at = now() WHERE id = $1**.
12. **INSERT audit_log** event_type='public_booking_cancelled', actor_label='public_booking', detail JSONB com {ip_hash, appointment_id, original_scheduled_at}.
13. **INSERT notifications** para admins do tenant: type='public_booking', reference_id=appointmentId, title="Agendamento público cancelado", body com nome do paciente + data.
14. **COMMIT**.
15. **Fire-and-forget**: email para o paciente confirmando cancelamento.
16. **Retornar 200** com dados.

---

## Anti-preview de email

**Crítico**: vários clients de email (Apple Mail, Gmail mobile) fazem **pré-fetch** de URLs nos emails para preview/proteção. Se a rota fosse `GET /api/public/booking/cancel/[token]` e cancelasse, **o preview cancelaria a consulta sem o paciente saber**.

**Mitigação**: a rota `/api/...` aceita apenas POST. A página GET `/agendar/[slug]/cancelar/[token]` é uma **tela intermediária**:
1. GET `/agendar/[slug]/cancelar/[token]` (link no email)
2. Server-side renderiza a tela com resumo do agendamento + botão "Confirmar cancelamento" (que faz POST via JavaScript ou form)
3. Submit POST → API → cancela

A página GET **NÃO modifica estado**. Só lê dados via novo helper read-only para mostrar resumo.

### GET `/agendar/[slug]/cancelar/[token]` — read-only

Retorna HTML da página de confirmação. Internamente:

1. Valida token (mesma lógica do POST passos 1-6) mas **não modifica** estado.
2. Se token inválido → 410 página amigável.
3. Se válido → renderiza resumo + botão confirmar.

A janela de cancelamento (`cancel_min_hours`) **é verificada já no GET**: se expirado, mostra contato da clínica e botão fica desabilitado.

---

## Acceptance behaviors

1. Token válido + dentro da janela → 200 com dados, slot liberado, audit + notification gerados, email enviado.
2. Token expirado → 410 genérico.
3. Token usado → 410 genérico.
4. Token fabricado/inválido → 410 genérico.
5. Token válido mas appointment já cancelado por outra via → 410.
6. Janela `cancel_min_hours` expirada → 422 com contato.
7. 6ª tentativa de cancelar em 1h do mesmo IP → 429.
8. GET com token válido → renderiza página, NÃO modifica estado.
9. POST sem token na URL → 404 (Next.js path param ausente).
10. Email preview do client (HEAD request ou GET prefetch) → não cancela (rota é POST).

# Contract — GET `/api/public/booking/[slug]/slots`

**Localização**: `src/app/api/public/booking/[slug]/slots/route.ts` (Next.js Route Handler).
**Acesso**: público (sem auth). Rate-limited.

---

## Request

```
GET /api/public/booking/[slug]/slots?doctor_id={uuid}&procedure_id={uuid}&from={YYYY-MM-DD}&to={YYYY-MM-DD}
```

### Path params

| Param  | Tipo   | Validação                   |
| ------ | ------ | --------------------------- |
| `slug` | string | `^[a-z0-9][a-z0-9-]{2,31}$` |

### Query params (todos obrigatórios)

| Param          | Tipo                | Validação                                            |
| -------------- | ------------------- | ---------------------------------------------------- |
| `doctor_id`    | UUID                | RFC 4122                                             |
| `procedure_id` | UUID                | RFC 4122                                             |
| `from`         | string `YYYY-MM-DD` | Data válida; ≥ hoje                                  |
| `to`           | string `YYYY-MM-DD` | Data válida; ≥ `from`; ≤ `from + 31 days` (anti-DoS) |

### Headers

- `X-Forwarded-For` ou similar usado para extrair IP do paciente → hash via SHA-256.
- **Não exige** token Turnstile (apenas leitura — captcha é no submit final).

---

## Response

### 200 OK — sucesso

```json
{
  "slots": [
    { "start": "2026-05-20T11:00:00Z", "end": "2026-05-20T11:30:00Z" },
    { "start": "2026-05-20T11:30:00Z", "end": "2026-05-20T12:00:00Z" }
  ],
  "timezone": "America/Sao_Paulo"
}
```

- `slots`: array de slots disponíveis em **UTC**. Client renderiza convertendo para `timezone`.
- `timezone`: TZ da clínica (usado no client para exibição).
- Array pode estar vazio se nenhum slot livre na janela (caso normal — fim de semana, médico sem disponibilidade no período).

### 404 Not Found — tenant/slug não existe ou feature desabilitada

```json
{ "error": "TENANT_NOT_FOUND_OR_DISABLED" }
```

**Importante**: não distingue "slug não existe" de "slug existe mas disabled" — evita probing de existência (FR-002).

### 400 Bad Request — params inválidos

```json
{
  "error": "INVALID_PARAMS",
  "details": [{ "field": "from", "message": "..." }]
}
```

### 403 Forbidden — médico/procedimento não publicados pelo tenant

```json
{ "error": "DOCTOR_PROCEDURE_NOT_PUBLISHED" }
```

A RPC `public_booking_slots` retorna 0 linhas neste caso. O server distingue "0 slots disponíveis" de "doctor/procedure não publicado" por uma chamada de verificação separada **antes** da chamada de slots, para retornar 403 explícito (melhor UX que silently 200 com array vazio).

### 429 Too Many Requests — rate limit

```json
{ "error": "RATE_LIMITED", "retryAfter": 45 }
```

Header `Retry-After: 45` também enviado.

### 500 Internal Server Error

Body genérico, sem detalhes. Erros completos só em logs server-side.

---

## Server-side flow

1. Validar path + query com Zod.
2. Calcular `ip_hash = sha256(ip + ':' + (slug-to-tenant-id))` — mas como ainda não resolvemos tenant, fallback: `sha256(ip + ':public-booking-pre-resolve')`. **Refinar pós-resolução**.
3. Verificar rate limit `view_slots`: `count(*)  WHERE ip_hash=? AND action='view_slots' AND created_at > now() - interval '1 minute'`. Se ≥10 → 429.
4. Resolver tenant via `public_booking_resolve_slug(slug)`. Se NULL → 404.
5. Verificar `(doctor_id, procedure_id)` está em `public_booking_doctor_procedures` para esse tenant. Se não → 403.
6. INSERT em `public_booking_rate_limits` com `action='view_slots'`.
7. Chamar `public_booking_slots(slug, doctor_id, procedure_id, from, to)`.
8. Retornar 200 com array.

---

## Performance

- **Latência alvo**: p95 ≤ 200ms.
- **Carga**: até 100 RPS por tenant (cap implícito do rate limit).
- **Caching**: HTTP `Cache-Control: private, max-age=30` (slots podem ficar stale por 30s — aceitável; submit revalida).

---

## Acceptance behaviors

1. Slug válido + médico publicado + procedimento publicado + datas válidas → 200 com array (vazio ou não).
2. Slug inválido → 404 (não distingue de disabled).
3. Médico não publicado → 403.
4. Datas inválidas (to < from, from < hoje, range > 31 dias) → 400.
5. 11ª requisição em 1 minuto do mesmo IP → 429 com `Retry-After`.
6. Tentativa de SQL injection no slug (`abc' OR '1'='1`) → 400 (regex falha) ou 404 (slug não existe).

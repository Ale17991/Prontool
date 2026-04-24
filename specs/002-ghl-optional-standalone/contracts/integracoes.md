# Contract: `/api/configuracoes/integracoes` (listar) + `/api/configuracoes/integracoes/[provider]` (conectar/desconectar)

Rotas genéricas para conectar/desconectar qualquer provider registrado. `[provider]` é validado contra o `registry` — valores fora dele retornam 404.

## Auth (todos os verbos)

- JWT Supabase obrigatório.
- `requireRole(['admin'])`. Outras roles → 403.

---

## `GET /api/configuracoes/integracoes`

Retorna status agregado de **todos** os providers registrados para o tenant da sessão. Providers não conectados aparecem com `connected: false`.

### Response 200

```json
{
  "integrations": [
    {
      "provider": "ghl",
      "label": "GoHighLevel",
      "description": "CRM e automação de marketing com webhooks e contatos",
      "connected": true,
      "enabled": true,
      "connected_since": "2026-03-12T10:44:00Z"
    },
    {
      "provider": "generic_webhook",
      "label": "Webhook genérico",
      "description": "Dispara POST JSON para uma URL configurada a cada evento do Pronttu",
      "connected": false,
      "enabled": false,
      "connected_since": null
    },
    {
      "provider": "hubspot",
      "label": "HubSpot",
      "description": "CRM HubSpot com engagements e contatos",
      "connected": false,
      "enabled": false,
      "connected_since": null
    }
  ]
}
```

Ordenação: conectados primeiro, depois alfabético por `label`.

### Errors

| Status | Code |
|--------|------|
| 401 | `UNAUTHENTICATED` |
| 403 | `FORBIDDEN` |

---

## `GET /api/configuracoes/integracoes/[provider]`

Status detalhado de um provider.

### Response 200 — não conectado

```json
{
  "provider": "ghl",
  "label": "GoHighLevel",
  "connected": false,
  "config_schema": { /* JSON Schema de configSchema para montar form dinâmico */ },
  "credentials_schema": { /* idem p/ credentialsSchema */ }
}
```

### Response 200 — conectado

```json
{
  "provider": "ghl",
  "label": "GoHighLevel",
  "connected": true,
  "enabled": true,
  "connected_since": "2026-03-12T10:44:00Z",
  "config": {
    "location_id": "abc123XYZ789",
    "trigger_stage_name": "Pagamento confirmado",
    "field_map_plano": "plano_saude",
    "field_map_procedimento_tuss": "procedimento_tuss",
    "field_map_profissional": "profissional",
    "field_map_valor": "valor_atendimento"
  },
  "credentials_redacted": {
    "operations_pat": "***",
    "inbound_webhook_secret": "***"
  },
  "config_schema": { /* … */ },
  "credentials_schema": { /* … */ }
}
```

**Nunca** retorna credenciais em claro. `credentials_redacted` é sempre o resultado de `adapter.redactCredentials`.

### Errors

| Status | Code |
|--------|------|
| 401 | `UNAUTHENTICATED` |
| 403 | `FORBIDDEN` |
| 404 | `PROVIDER_NOT_FOUND` (provider não está no registry) |

---

## `POST /api/configuracoes/integracoes/[provider]`

Conecta (insert) ou reconfigura (update). Sempre envia payload completo (config + credentials).

### Request

```json
{
  "config": {
    "location_id": "abc123XYZ789",
    "trigger_stage_name": "Pagamento confirmado",
    "field_map_plano": "plano_saude",
    "field_map_procedimento_tuss": "procedimento_tuss",
    "field_map_profissional": "profissional",
    "field_map_valor": "valor_atendimento"
  },
  "credentials": {
    "operations_pat": "pit-xxxxxxxxxxxxxxxxxxxx",
    "inbound_webhook_secret": "super-secret-string-32-chars"
  },
  "enabled": true,
  "reason": "Conectando integração para migração Q2"
}
```

### Schema (runtime, dinâmico)

```ts
z.object({
  config: registry[provider].configSchema,
  credentials: registry[provider].credentialsSchema,
  enabled: z.boolean().optional().default(true),
  reason: z.string().trim().min(3).max(500),
})
```

Provider `generic_webhook` exemplo:

```json
{
  "config": {
    "outbound_url": "https://hooks.minhaempresa.com/pronttu",
    "events": ["patient.created", "appointment.created"]
  },
  "credentials": {
    "bearer_token": "optional-but-recommended"
  },
  "enabled": true,
  "reason": "Integrando com nosso data lake"
}
```

### Response 201 (first-time connect)

```json
{
  "provider": "ghl",
  "connected": true,
  "action": "connected",
  "connected_since": "2026-04-24T14:30:00Z"
}
```

### Response 200 (reconfigure)

```json
{
  "provider": "ghl",
  "connected": true,
  "action": "reconfigured",
  "connected_since": "2026-03-12T10:44:00Z"
}
```

### Errors

| Status | Code |
|--------|------|
| 400 | `INVALID_BODY` (schema fail) |
| 401 | `UNAUTHENTICATED` |
| 403 | `FORBIDDEN` |
| 404 | `PROVIDER_NOT_FOUND` |
| 500 | `INTERNAL_ERROR` |

### Side effects

1. Cifrar `credentials` via `enc_text_with_key` → `credentials_enc` (JSON stringificado antes da cifra).
2. Cifrar `webhook_secret` (se o provider tem inbound) separadamente → `webhook_secret_enc`.
3. UPSERT em `tenant_integrations` por `(tenant_id, provider)`.
4. Entrada em `audit_log`:
   - `event_type='integration.connect' | 'integration.reconfigure'`
   - `entity_type='tenant_integrations'`, `entity_id="<tenant_id>:<provider>"`
   - `before_value`/`after_value` com `adapter.redactCredentials()` aplicado
   - `reason` do body
   - `request_ip` + `user_agent` dos headers

---

## `DELETE /api/configuracoes/integracoes/[provider]`

Desconecta o provider para o tenant. Remove a linha fisicamente. Histórico de pacientes/atendimentos permanece.

### Request

```json
{ "reason": "Cliente encerrou contrato com esse CRM" }
```

### Response 200

```json
{ "provider": "ghl", "connected": false, "action": "disconnected" }
```

### Response 200 — idempotente

```json
{ "provider": "ghl", "connected": false, "action": "noop" }
```

### Errors

| Status | Code |
|--------|------|
| 400 | `INVALID_BODY` (reason ausente) |
| 401 | `UNAUTHENTICATED` |
| 403 | `FORBIDDEN` |
| 404 | `PROVIDER_NOT_FOUND` |

### Side effects

1. `DELETE FROM tenant_integrations WHERE tenant_id = session.tenantId AND provider = :provider`.
2. Entrada em `audit_log` `event_type='integration.disconnect'` com `before_value` redacted e `after_value=null`.
3. Pacientes/atendimentos ligados ao provider (ex.: `patients.ghl_contact_id`) **não são alterados** (FR-009).
4. Eventos inbound já enfileirados em DLQ/QStash continuam (spec §Edge Cases).

# Contract — `/api/configuracoes/integracoes/ghl` + `/sync-log`

**Feature**: 008-ghl-marketplace-oauth
**Files**: `src/app/api/configuracoes/integracoes/ghl/route.ts`, `src/app/api/configuracoes/integracoes/ghl/sync-log/route.ts`

API que alimenta a página `/configuracoes/integracoes/ghl` com o estado completo da integração e dispara desconexão. Reusa a estrutura genérica de `/api/configuracoes/integracoes/[provider]` para `provider='ghl'` mas adiciona endpoints específicos do OAuth.

---

## `GET /api/configuracoes/integracoes/ghl`

**Auth**: sessão Prontool obrigatória. Retorna o mesmo payload para qualquer papel — não é informação sensível, só estado/metadata. Botões de ação na UI só aparecem para `admin`.

**Resposta** (200):

```json
{
  "status": "connected" | "disconnected" | "token_expired" | "not_connected",
  "sub_account_name": "Clínica X" | null,
  "location_id": "abc123..." | null,
  "timezone": "America/Sao_Paulo" | null,
  "connected_at": "2026-05-04T15:00:00Z" | null,
  "scopes": ["contacts.readonly", "contacts.write", ...] | null,
  "custom_fields": [
    {"slug": "cpf", "name": "CPF", "id": "cf_...", "alias": "prontool_cpf"},
    ...
  ],
  "webhooks": [
    {"event": "ContactCreate", "id": "hk_..."},
    ...
  ],
  "menu_status": "registered" | "unsupported" | "failed" | "not_attempted",
  "warnings": ["custom_menu_unsupported", "custom_field_partial:diagnosticos_ativos"],
  "last_sync_at": "2026-05-04T16:30:00Z" | null
}
```

**O que MUST nunca aparecer** (nem em `data-*`, nem em comentários, nem em logs do server): `access_token`, `refresh_token`, `expires_at` literal, `client_secret`, conteúdo de `credentials_enc`.

**Status mapping**:

| Linha em DB | `status` no body |
|---|---|
| Sem linha | `not_connected` |
| `enabled=true AND status='connected'` | `connected` |
| `enabled=true AND status='token_expired'` | `token_expired` |
| `enabled=false AND status='disconnected'` | `disconnected` |

---

## `DELETE /api/configuracoes/integracoes/ghl`

Desconectar manualmente.

**Auth**: `requireRole('admin')`.

**Body**: vazio (ou `{ reason: string }` opcional).

**Comportamento**:

1. Carrega linha `tenant_integrations`. Se ausente → 404 `NOT_CONNECTED`.
2. Chama `disconnect-tenant.ts` (mesmo core do uninstall):
   - Tenta `DELETE /hooks/{id}` em best-effort.
   - Tenta `DELETE /custom-menus/{menu_id}` se aplicável.
   - Não deleta custom fields.
   - Marca `enabled=false`, `status='disconnected'`.
   - `audit_log` `integration.disconnect` (`actor=user_id`, `motivo='manual_disconnect'`, `reason` em detail).
   - `integration_sync_log(kind='disconnect')`.
3. Responde 200 `{ ok: true }`.

| Status | Body |
|---|---|
| 200 | `{ ok: true }` |
| 401 | `{ error: { code: 'UNAUTHENTICATED' } }` |
| 403 | `{ error: { code: 'FORBIDDEN_ROLE' } }` |
| 404 | `{ error: { code: 'NOT_CONNECTED' } }` |
| 502 | `{ error: { code: 'PARTIAL_CLEANUP', detail: { hooks_remaining: [...] } } }` (somente se `enabled=false` foi gravado mas cleanup do GHL falhou; UI tolera e mostra warning) |

---

## `POST /api/configuracoes/integracoes/ghl`

Manter para back-compat com o caminho legado `/api/configuracoes/integracoes/[provider]`. Permite **apenas** atualizar campos não-credenciais do `config` (ex.: trigger_stage_name para tenants em formato Feature 002 que ainda não migraram). NÃO aceita tokens, NÃO refaz OAuth.

**Auth**: `requireRole('admin')`.

**Body**: subset de `GhlConfigV2` sem credenciais. Campos OAuth (`location_id`, `sub_account_name`, `custom_field_ids`, `webhook_ids`, `menu_id`) **ignorados** se enviados — esses só mudam via `connect-tenant.ts`.

| Status | Body |
|---|---|
| 200 | `{ ok: true, config: <sanitized> }` |
| 400 | `{ error: { code: 'INVALID_BODY' } }` |
| 401/403 | erro de auth |
| 404 | `{ error: { code: 'NOT_CONNECTED' } }` |

**Audit**: `integration.reconfigure` com diff.

---

## `GET /api/configuracoes/integracoes/ghl/sync-log`

Retorna últimas 10 entradas de `integration_sync_log` para o tenant da sessão.

**Auth**: sessão obrigatória. Qualquer papel pode ler (apoia diagnóstico cooperativo); UI só renderiza para admin.

**Resposta**:

```json
{
  "items": [
    {
      "id": "...",
      "occurred_at": "2026-05-04T16:30:00Z",
      "kind": "outbound_contact",
      "status": "success",
      "error_code": null,
      "error_message": null,
      "summary": "Paciente Maria Silva sincronizado para GHL"
    },
    {
      "id": "...",
      "occurred_at": "2026-05-04T15:45:00Z",
      "kind": "outbound_note",
      "status": "failure",
      "error_code": "GHL_401",
      "error_message": "Token revoked",
      "summary": null
    }
  ]
}
```

**Construção de `summary`**: derivado server-side de `detail` JSONB (que tem `patient_name`, `appointment_id`, etc.) — **nunca** contém PII bruta sem mascarar. CPF mascarado tipo `***.456.789-**`. Telefone idem.

| Status | Body |
|---|---|
| 200 | `{ items: [...] }` (até 10 entradas, mais recentes primeiro) |
| 401 | `{ error: { code: 'UNAUTHENTICATED' } }` |

---

## Tests (contract)

`tests/contract/ghl-config-detail.spec.ts`:

- `GET` em tenant não conectado → `status: 'not_connected'`, demais campos `null`.
- `GET` em tenant conectado → todos os 6 custom_fields, 3 webhooks, `menu_status`. **Grep** no body para confirmar que não há `access_token`/`refresh_token`/`secret`.
- `GET` em tenant `token_expired` → `status: 'token_expired'`, custom_fields e webhooks ainda visíveis.
- `DELETE` por admin → status muda para `disconnected`, `audit_log` row presente.
- `DELETE` por não-admin → 403 + `audit_log` deny.
- `DELETE` em tenant não conectado → 404.
- `POST` por admin com config válida → 200, `audit_log` reconfigure.
- `POST` tentando enviar `credentials_enc` ou `access_token` → campos ignorados (não persistidos), 200.
- `GET /sync-log` → ordenado desc, máximo 10 itens, sem PII bruta.

## Mascaramento de PII no detail

Helper `maskPii(value: string, kind: 'cpf'|'phone'|'email')`:

- CPF `123.456.789-01` → `***.456.789-**`
- Telefone `+55 11 99999-1234` → `+55 11 9****-12**`
- Email `maria@example.com` → `m****@example.com`

Usado tanto na construção do `summary` quanto antes de gravar `detail` no `integration_sync_log`. Logs do servidor (Pino) recebem o mesmo tratamento.

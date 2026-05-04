# Contract — `/api/webhooks/ghl/{install,uninstall}`

**Feature**: 008-ghl-marketplace-oauth
**Files**: `src/app/api/webhooks/ghl/install/route.ts`, `src/app/api/webhooks/ghl/uninstall/route.ts`

Webhooks chamados pelo GHL Marketplace quando uma sub-account instala ou desinstala o app Prontool. **NÃO** correm sob sessão de usuário — são autenticados por HMAC compartilhado (`GHL_MARKETPLACE_SHARED_SECRET`).

---

## `POST /api/webhooks/ghl/install`

**Headers obrigatórios**:

- `x-wh-signature: <hex sha256>` — HMAC-SHA256 do raw body com `GHL_MARKETPLACE_SHARED_SECRET`. (default; ver research item 3 — pode mudar para `x-ghl-signature` após verificação contra doc oficial)
- `x-wh-timestamp: <epoch seconds>` — janela ±5 min anti-replay.
- `content-type: application/json`.

**Body** (formato esperado, sujeito a verificação):

```json
{
  "eventId": "evt_...",        // identificador único do evento (idempotência)
  "type": "INSTALL",
  "appId": "<our app id>",
  "companyId": "...",
  "locationId": "...",         // sub-account
  "location": {
    "id": "...",
    "name": "Clínica X",
    "timezone": "America/Sao_Paulo",
    "countryCode": "BR"
  },
  "user": {
    "id": "...",
    "email": "...",
    "firstName": "...",
    "lastName": "...",
    "type": "Location"
  },
  "tokens": {
    "access_token": "...",
    "refresh_token": "...",
    "expires_in": 86400,
    "scope": "contacts.readonly contacts.write ..."
  },
  "installedAt": "2026-05-04T15:00:00Z"
}
```

**Comportamento**:

1. Lê raw body antes de qualquer parsing JSON.
2. `verifyMarketplaceSignature(rawBody, headers, GHL_MARKETPLACE_SHARED_SECRET)`:
   - Valida `x-wh-timestamp` em janela ±5 min (rejeita stale).
   - Computa HMAC e compara com `x-wh-signature` via `timingSafeEqual`.
   - Falha → 401 `INVALID_SIGNATURE`. Registra `audit_log` `oauth.signature_failure_marketplace` (sem `tenant_id`). Alerta operacional `signature_failure` global (não por tenant).
3. Faz parse JSON e valida shape via Zod (`marketplaceInstallSchema`).
4. Idempotência via `ingestRawEvent(supabase, { tenantId: null, ghlEventId: eventId, payload, headers })`. Se duplicate → retorna 200 imediatamente sem processar.
5. Resolve tenant:
   - Busca `tenant_integrations` com `location_id = body.locationId AND provider='ghl'` (mesmo se `enabled=false` — para reativar reinstalação).
   - Se encontra → atualiza tokens, `enabled=true`, `status='connected'`, `connected_at=now()`. Mantém `tenant_id` existente.
   - Se não encontra → cria tenant novo (`INSERT INTO tenants (name, timezone)`) e em seguida cria `tenant_integrations`.
6. Chama `connect-tenant.ts` (mesmo core do callback OAuth) com `actor='system:ghl_marketplace_install'`. `audit_log` `integration.connect`.
7. Dispara `post-connect-setup.ts` em best-effort (não bloqueia a resposta 200).
8. Retorna 200 imediatamente: `{ received: true, duplicate: false, tenant_id: '...' }`.

**Pontos delicados**:

- Tenant criação corre com **service-role client** (bypassa RLS). Esse é o único lugar dessa feature autorizado a criar `tenants`. RBAC: o webhook é confiável apenas porque a assinatura HMAC compartilhada validou; sem validação, 401 imediato.
- Mapeamento `location_id → tenant`: se `location_id` já existe em `tenant_integrations` mas `enabled=false` foi por **uninstall** recente (< 30 dias), reativamos a mesma linha — tenant fica intacto. Se `enabled=false` foi por **disconnect manual** (admin clicou em Desconectar), ainda assim reativamos: a chave de unicidade é `location_id`, não a origem do disconnect. (Audit registra `actor='system:ghl_marketplace_install'` para diferenciar.)
- Cross-tenant safety: índice unique parcial em `tenant_integrations` (provider='ghl', enabled=true, location_id IS NOT NULL) bloqueia o caso patológico de duas linhas ativas.

**Resposta**:

| Status | Body | Quando |
|---|---|---|
| 200 | `{ received: true, duplicate: false, tenant_id }` | Sucesso (novo ou atualizado). |
| 200 | `{ received: true, duplicate: true }` | Replay do mesmo `eventId`. |
| 400 | `{ error: { code: 'INVALID_BODY', issues } }` | JSON inválido / shape errado. |
| 401 | `{ error: { code: 'INVALID_SIGNATURE' } }` | HMAC ou janela falharam. |
| 500 | `{ error: { code: 'INSTALL_FAILED', correlation_id } }` | Erro inesperado pós-validação. Não retornar 5xx por erro do post-connect-setup — esse é best-effort. |

**Audit**:

- `oauth.signature_failure_marketplace` em 401.
- `integration.connect` em sucesso (`actor='system:ghl_marketplace_install'`, `motivo='marketplace_install'`, `valor_anterior=<status anterior>`, `valor_novo='connected'`, `entidade='tenant_integrations'`).

---

## `POST /api/webhooks/ghl/uninstall`

**Headers**: idênticos a `/install`.

**Body** (formato esperado):

```json
{
  "eventId": "evt_...",
  "type": "UNINSTALL",
  "appId": "<our app id>",
  "companyId": "...",
  "locationId": "...",
  "uninstalledAt": "2026-05-04T15:00:00Z",
  "reason": "user_request" | "billing" | "...",
}
```

**Comportamento**:

1. Validação de assinatura (igual install).
2. Idempotência via `ingestRawEvent`.
3. Resolve tenant pela `location_id`:
   - Se nenhum match: 200 `{ received: true, no_match: true }` (sem efeito; pode ser app instalado/desinstalado em sub-account que nunca chegou no Prontool).
   - Se match: chama `disconnect-tenant.ts` (`actor='system:ghl_marketplace_uninstall'`):
     - Tenta `DELETE /hooks/{id}` para cada `webhook_ids` armazenado (best-effort, com timeout 5s/cada).
     - Tenta `DELETE /custom-menus/{menu_id}` se aplicável.
     - **Não deleta** custom fields (admin pode querer manter os dados clínicos no GHL).
     - Marca `enabled=false`, `status='disconnected'`. **Não** apaga `credentials_enc` (mantém para auditoria — campo é só BYTEA cifrado, sem PII).
     - `audit_log` `integration.disconnect`.
     - `integration_sync_log(kind='disconnect', status='success')`.
4. Retorna 200.

**Resposta**:

| Status | Body |
|---|---|
| 200 | `{ received: true, duplicate: false, tenant_id }` |
| 200 | `{ received: true, no_match: true }` |
| 200 | `{ received: true, duplicate: true }` |
| 400 | `{ error: { code: 'INVALID_BODY' } }` |
| 401 | `{ error: { code: 'INVALID_SIGNATURE' } }` |
| 500 | `{ error: { code: 'UNINSTALL_FAILED' } }` (apenas se erro persistente impedir marcar `enabled=false`) |

**Audit**: `integration.disconnect` (`motivo='marketplace_uninstall'`, `actor='system:ghl_marketplace_uninstall'`).

---

## Tests (contract)

`tests/contract/marketplace-webhooks.spec.ts`:

- `POST /install` com assinatura válida → cria tenant + tenant_integrations, post-connect-setup roda, 200.
- `POST /install` com mesmo `eventId` 2x → segunda chamada retorna 200 com `duplicate: true`, sem novo tenant.
- `POST /install` para `location_id` já mapeada → atualiza tokens, **não** cria tenant novo, 200.
- `POST /install` com assinatura inválida → 401, sem efeito no banco.
- `POST /install` com `x-wh-timestamp` muito antigo → 401, sem efeito.
- `POST /install` com body sem `tokens.refresh_token` → 400 `INVALID_BODY`.
- `POST /uninstall` happy-path → tenant desconectado, webhooks/menu best-effort removidos via mock.
- `POST /uninstall` para `locationId` desconhecida → 200 `no_match: true`.
- `POST /uninstall` quando GHL retorna 5xx no `DELETE /hooks/...` → 200 mesmo assim, mas integration_sync_log marca `kind='disconnect'` `status='failure'` para os hooks específicos. `tenant_integrations.enabled` AINDA é `false`.

## Tests (integration)

`tests/integration/integrations/ghl/marketplace-install.spec.ts`:

- Install em ambiente limpo → tenant + ~6 custom fields no MSW + 3 webhooks no MSW.
- Reinstall (uninstall → install) → tenant_id preservado, tokens novos, custom_field_ids preservados (idempotência por nome).
- Install em location_id já existente → conflito mitigado pelo unique index.

## Ordem de inicialização (post-connect-setup)

`post-connect-setup.ts` é chamado pós-conexão (manual ou marketplace) em fundo, encadeando:

1. `customFieldsSetup(supabase, tenantId, accessToken, locationId)` → produz `custom_field_ids`.
2. `webhooksSetup(supabase, tenantId, accessToken, locationId, prontoolBaseUrl)` → produz `webhook_ids`.
3. `customMenuSetup(supabase, tenantId, accessToken, locationId, prontoolBaseUrl)` → best-effort, atualiza `menu_status`.

Cada passo grava em `integration_sync_log` independentemente (sucesso/falha) e atualiza `tenant_integrations.config` no fim. Ordem importa só pelo log claro — não há dependência de dados entre eles.

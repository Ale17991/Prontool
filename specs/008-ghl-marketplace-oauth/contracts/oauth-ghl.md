# Contract — `/api/oauth/ghl/{authorize,callback,refresh}`

**Feature**: 008-ghl-marketplace-oauth
**Files**: `src/app/api/oauth/ghl/{authorize,callback,refresh}/route.ts`

Endpoints que cobrem o fluxo OAuth 2.0 manual (admin clica em "Conectar"). O fluxo Marketplace (`INSTALL`/`UNINSTALL`) está em `marketplace-webhooks.md` mas converge no mesmo core (`connect-tenant.ts`).

---

## `GET /api/oauth/ghl/authorize`

Inicia o fluxo. Admin abre essa URL (botão "Conectar ao GoHighLevel") e é redirecionado para a tela de consentimento do GHL.

**Auth**: `requireRole('admin')`. Sessão do Prontool obrigatória — `tenant_id` e `user_id` extraídos do JWT.

**Comportamento**:

1. Gera `state = HMAC_SHA256(<server_secret>, "${tenant_id}:${user_id}:${nonce}:${issued_at}")` e armazena nonce/issued_at em cookie HttpOnly assinado (TTL 10 min) para validar no callback.
2. Monta URL: `https://marketplace.gohighlevel.com/oauth/chooselocation?response_type=code&redirect_uri=<GHL_REDIRECT_URI>&client_id=<GHL_CLIENT_ID>&scope=<GHL_SCOPES>&state=<state>`.
3. Responde **302** para essa URL.

**Resposta**:

| Status | Body                                          | Headers                                                                                                                               |
| ------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 302    | (vazio)                                       | `Location: <chooselocation URL>`, `Set-Cookie: ghl_oauth_state=...; HttpOnly; Secure; SameSite=Lax; Path=/api/oauth/ghl; Max-Age=600` |
| 401    | `{ error: { code: 'UNAUTHENTICATED' } }`      | —                                                                                                                                     |
| 403    | `{ error: { code: 'FORBIDDEN_ROLE' } }`       | (registra `audit_log` deny)                                                                                                           |
| 500    | `{ error: { code: 'OAUTH_CONFIG_MISSING' } }` | (uma das `GHL_*` env vars faltando)                                                                                                   |

**Audit**: nenhum (apenas redirect). Falha 403 registra deny via `audit/deny.ts`.

---

## `GET /api/oauth/ghl/callback`

GHL redireciona o admin de volta com `?code=...&state=...`. **NÃO** exige sessão — o cookie de state assinado é o que liga callback à requisição original; após o exchange, derivamos o tenant do `state`.

**Comportamento**:

1. Valida `state` cookie HMAC + match com query `state`. Falha → 401 `STATE_MISMATCH`.
2. Valida idade do nonce (≤ 10 min).
3. Extrai `tenant_id` + `user_id` do `state` (lado canônico) e abre Supabase service-role client (callback corre fora de RLS de usuário porque o cookie de sessão pode ter expirado em janelas longas).
4. `POST https://services.leadconnectorhq.com/oauth/token` com `grant_type=authorization_code`, `client_id`, `client_secret`, `redirect_uri`, `code`, `user_type=Location`. Timeout 5s, 1 retry com backoff em 5xx.
5. Resposta esperada: `{ access_token, refresh_token, expires_in, scope, userType, locationId, companyId, userId }`.
6. Chama `connect-tenant.ts`:
   - Faz `INSERT ... ON CONFLICT (tenant_id, provider) DO UPDATE` em `tenant_integrations` com `enabled=true`, `status='connected'`, `connected_at=now()`, `credentials_enc=enc(JSON do par + metadados)`, `config={ location_id, sub_account_name, timezone, ... }` (preserva `custom_field_ids`/`webhook_ids` antigos se existirem).
   - Registra `audit_log` `integration.connect` (`actor=user_id`, `motivo='manual_connect'`).
   - Insere `integration_sync_log(kind='connect', status='success')`.
   - Dispara `post-connect-setup.ts` em best-effort (custom fields + webhooks + custom menu). Falhas individuais são gravadas em `integration_sync_log` mas **não** revertem a conexão.
7. Limpa cookie de state (`Max-Age=0`).
8. Redireciona **302** para `/configuracoes/integracoes/ghl?status=connected` (ou `?status=connected&warnings=custom_menu_unsupported,custom_fields_partial` se o setup teve falhas parciais).

**Resposta**:

| Status | Body                                                                       | Quando                                                                   |
| ------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 302    | —                                                                          | Sucesso (com ou sem warnings). Location aponta para a página de detalhe. |
| 400    | `{ error: { code: 'CODE_MISSING' \| 'STATE_MISSING' } }`                   | Query incompleta.                                                        |
| 401    | `{ error: { code: 'STATE_MISMATCH' \| 'STATE_EXPIRED' } }`                 | Cookie ausente / não bate.                                               |
| 502    | `{ error: { code: 'CODE_EXCHANGE_FAILED', detail: '<status from GHL>' } }` | GHL retornou 4xx/5xx no `/oauth/token`. Sem persistência.                |

**Audit**:

- Sucesso: `integration.connect` (descrito acima).
- Code exchange failed: `integration.refresh_failed`-like entry com `motivo='code_exchange_failed'` para fechar a trilha de "tentou conectar mas falhou".
- State mismatch: `integration.signature_failure` (não exatamente — usar `event_type='oauth.state_mismatch'`); alerta operacional opcional.

**Idempotência**: se o admin der refresh no callback (mesmo `code` reusado), GHL retorna 4xx; tratamos como `CODE_EXCHANGE_FAILED` sem persistência. Estado prévio do tenant_integrations preservado.

---

## `POST /api/oauth/ghl/refresh`

Internal-only — usado pela UI quando admin clica explicitamente em "Forçar refresh agora" (debug/diagnóstico). NÃO é chamado pelo fluxo normal — refresh automático corre dentro de `withGhlAuth`. Separado para ter um caminho auditável e CSRF-protected.

**Auth**: `requireRole('admin')` + CSRF token.

**Body**: vazio (tenant vem da sessão).

**Comportamento**:

1. Lê linha `tenant_integrations(provider='ghl')` do tenant.
2. Decifra credentials, chama `refreshTokens(refresh_token)` em `oauth/client.ts`.
3. Persiste novos tokens, atualiza `audit_log` `integration.refresh_success`, sync log.
4. Em falha: marca `status='token_expired'`, `audit_log` `integration.refresh_failed`, alerta `integration_sync_failed`.

**Resposta**:

| Status  | Body                                                                      |
| ------- | ------------------------------------------------------------------------- |
| 200     | `{ ok: true, expires_at: '<ISO>' }`                                       |
| 401/403 | erro de auth                                                              |
| 404     | `{ error: { code: 'NOT_CONNECTED' } }` (sem linha em tenant_integrations) |
| 502     | `{ error: { code: 'REFRESH_FAILED', will_require_reconnect: true } }`     |

**Não documentado em UI por enquanto** — só engenheiro chamando via DevTools. Pode ser surfado em UI futura.

---

## Erros (catálogo único)

| code                   | HTTP | Significado                                    |
| ---------------------- | ---- | ---------------------------------------------- |
| `UNAUTHENTICATED`      | 401  | Sem sessão Prontool.                           |
| `FORBIDDEN_ROLE`       | 403  | Não-admin.                                     |
| `OAUTH_CONFIG_MISSING` | 500  | Env var GHL\_\* ausente.                       |
| `STATE_MISSING`        | 400  | Query `?state=` ausente.                       |
| `STATE_MISMATCH`       | 401  | HMAC ou cookie não bate.                       |
| `STATE_EXPIRED`        | 401  | Cookie de state > 10 min.                      |
| `CODE_MISSING`         | 400  | Query `?code=` ausente.                        |
| `CODE_EXCHANGE_FAILED` | 502  | `/oauth/token` retornou erro.                  |
| `REFRESH_FAILED`       | 502  | Refresh token inválido/revogado.               |
| `NOT_CONNECTED`        | 404  | Sem linha tenant_integrations(provider='ghl'). |

## Tests (contract)

`tests/contract/oauth-ghl.spec.ts` cobre:

- `GET /authorize` 302 com Location e cookie de state set; HMAC válido.
- `GET /authorize` sem admin → 403 + `audit_log` deny.
- `GET /callback` happy-path → 302 com `tenant_integrations` upserted, `credentials_enc` non-null, `audit_log` row presente. Tokens retornados pelo MSW são fixos; teste valida que **não** aparecem em response body.
- `GET /callback` com state mismatch → 401, sem mutação no banco.
- `GET /callback` com `/oauth/token` retornando 400 → 502, sem mutação no banco.
- Reuse do mesmo `code` (segunda chamada) → 502, sem corrupção do estado prévio.
- `POST /refresh` happy-path e refresh failure (incluindo transição para `status='token_expired'`).
- Concorrência de 2 chamadas ao `withGhlAuth` quando o token está estourando: somente 1 hit no `/oauth/token` mock (advisory lock).

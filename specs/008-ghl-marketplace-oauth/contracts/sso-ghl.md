# Contract — `/api/sso/ghl`

**Feature**: 008-ghl-marketplace-oauth (User Story 5, P3)
**File**: `src/app/api/sso/ghl/route.ts`

Endpoint que recebe o usuário GHL clicando no Custom Menu (registrado pela feature) e o autentica no Prontool sem login adicional. Renderizado em iframe dentro do app GHL.

> **Status escopo**: User Story 5 entregue como P3 com fallback gracioso. Mesmo que o registro programático do Custom Menu falhe (item 5 do research), este endpoint **funciona** se o admin do tenant configurar manualmente o menu apontando para `/api/sso/ghl?context_token=...`.

---

## `GET /api/sso/ghl`

**Query params**:

- `context_token` (string, obrigatório): JWT assinado pelo GHL Marketplace contendo `{ iss, aud, exp, iat, locationId, userId, userType, companyId }`.
- `redirect_to` (string, opcional, default `/`): rota interna do Prontool para onde levar após auth. Validada contra allowlist de paths (não permite hosts externos).

**Comportamento**:

1. **Validação do JWT**:
   - `verifySsoToken(context_token)` — busca JWKS de `GHL_SSO_JWKS_URL` (cache 1h em memória), valida `iss` esperado (`https://services.leadconnectorhq.com` ou variantes), `aud=GHL_CLIENT_ID`, `exp > now`, `iat < now + 60s`.
   - Falha → 401 `INVALID_CONTEXT_TOKEN`.
2. **Resolução do tenant**:
   - Busca `tenant_integrations` com `location_id = jwt.locationId AND provider='ghl' AND enabled=true`.
   - Se não encontra → 401 `TENANT_NOT_CONNECTED` (provavelmente sub-account está com integração desconectada; UI orienta a reconectar).
3. **Resolução do usuário**:
   - Busca usuário Prontool com `external_id = jwt.userId AND tenant_id = <resolved>`.
   - Se não encontra:
     - Se `auto_provisioning=true` na config (default `false` por segurança) → cria mapeamento usando `email` do JWT, papel `recepcionista` (mais restrito por padrão); admin pode promover depois.
     - Se `auto_provisioning=false` → 403 `USER_NOT_MAPPED` com instrução para o admin do tenant ligar manualmente o usuário.
4. **Criação de sessão**:
   - Gera JWT Supabase com `tenant_id`, `user_id`, `role`, `iat`, `exp` (TTL 8h).
   - Set-Cookie: `prontool_session=<jwt>; HttpOnly; Secure; SameSite=None; Path=/`.
   - SameSite=None é obrigatório para cookies em iframe cross-origin (GHL hospeda o iframe em `app.gohighlevel.com`).
5. **Resposta**:
   - `302` para `redirect_to` validado (default `/`).
   - Headers: `Content-Security-Policy: frame-ancestors https://app.gohighlevel.com https://*.gohighlevel.com`. `X-Frame-Options` **omitido** (deixar CSP cuidar — `X-Frame-Options: ALLOW-FROM` é depreciado e não tem multi-origin).

**Audit**: `sso.login` em `audit_log` com `actor=<user_id resolved>`, `motivo='ghl_marketplace_sso'`, `entidade='sessions'`, `valor_anterior=null`, `valor_novo=<masked session id>`. Nunca grava o `context_token` bruto.

---

## Resposta

| Status | Body                                                                     | Quando                                                                         |
| ------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| 302    | —                                                                        | Sucesso. Cookie de sessão set, redirect para `redirect_to`.                    |
| 400    | `{ error: { code: 'CONTEXT_TOKEN_MISSING' } }`                           | Query incompleta.                                                              |
| 401    | `{ error: { code: 'INVALID_CONTEXT_TOKEN' \| 'TENANT_NOT_CONNECTED' } }` | JWT inválido ou tenant não conectado.                                          |
| 403    | `{ error: { code: 'USER_NOT_MAPPED' } }`                                 | Usuário GHL sem usuário Prontool correspondente e auto-provisioning desligado. |
| 500    | `{ error: { code: 'SSO_CONFIG_MISSING' } }`                              | Variável `GHL_SSO_JWKS_URL` ausente.                                           |

Em todas as respostas de erro, **o body NÃO contém o `context_token`** (mesmo redacted) — apenas o `code`.

---

## Auto-provisioning de usuário (config)

Por default, `tenant_integrations.config.sso_auto_provisioning = false`. Admin pode ligar via PATCH em `/api/configuracoes/integracoes/ghl` (acrescentar campo no schema). Quando ligado:

- Cria `user` no Prontool se ausente, com `email = jwt.email` e papel `recepcionista`.
- Liga `external_id = jwt.userId` para idempotência futura.
- `audit_log` `user.created` com `motivo='ghl_sso_auto_provisioning'`.

---

## Tests (contract)

`tests/contract/sso-ghl.spec.ts`:

- Token válido + tenant conectado + usuário mapeado → 302, cookie set, audit row presente.
- Token expirado → 401 `INVALID_CONTEXT_TOKEN`.
- Token assinado com chave errada → 401.
- `aud` errado → 401.
- Tenant existe mas `enabled=false` → 401 `TENANT_NOT_CONNECTED`.
- Usuário não mapeado, auto-provisioning desligado → 403 `USER_NOT_MAPPED`.
- Usuário não mapeado, auto-provisioning ligado → cria usuário com papel `recepcionista`, 302.
- `redirect_to=https://evil.com` → ignorado, redireciona para `/`.
- Body de resposta nunca contém o `context_token`.

## Headers de iframe

Reaplicar `frame-ancestors` em **todas** as rotas do dashboard quando a sessão veio do SSO (cookie marker). Opção mais simples: middleware Next.js que, ao detectar cookie `prontool_session_origin=sso_ghl`, injeta `Content-Security-Policy: frame-ancestors https://app.gohighlevel.com https://*.gohighlevel.com` na resposta.

Para sessões normais (login direto), manter `frame-ancestors 'none'` (default seguro).

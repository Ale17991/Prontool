# Quickstart — Integração GHL Marketplace (OAuth 2.0)

**Feature**: `008-ghl-marketplace-oauth`
**Audiência**: dev local trabalhando na branch `008-ghl-marketplace-oauth`.

---

## 0. Pré-requisitos

- Node 20 LTS, `pnpm` instalado.
- Docker rodando (Supabase local).
- `ngrok` (ou similar — `cloudflared`, Tailscale Funnel) para expor `localhost:3000` na internet — webhooks Marketplace precisam de URL pública.
- App de teste no GHL Marketplace Sandbox com:
  - `client_id` + `client_secret`
  - `redirect_uri` apontando para a URL ngrok: `https://<seu-tunel>.ngrok-free.app/api/oauth/ghl/callback`
  - URLs de webhook `INSTALL`/`UNINSTALL` apontando para `https://<seu-tunel>.ngrok-free.app/api/webhooks/ghl/install` e `/uninstall`
  - Escopos solicitados: `contacts.readonly contacts.write custom-fields.readonly custom-fields.write locations.readonly opportunities.write webhooks.readonly webhooks.write`

---

## 1. Subir o stack local

```bash
# Banco (porta 54321 — não usar cloud em dev)
supabase start

# Aplica todas as migrations incluindo 0062_ghl_oauth_marketplace.sql
pnpm supabase:reset

# Gera tipos TS atualizados
pnpm supabase:gen-types

# Sobe o app
pnpm dev   # http://localhost:3000
```

Em outra aba, túnel:

```bash
ngrok http 3000
# Copie o https://xxxxx.ngrok-free.app
```

---

## 2. Variáveis de ambiente

Acrescentar a `.env.local`:

```bash
# OAuth client do app no Marketplace (Sandbox para dev)
GHL_CLIENT_ID=xxxxxxxxxxxx
GHL_CLIENT_SECRET=xxxxxxxxxxxx
GHL_REDIRECT_URI=https://xxxxx.ngrok-free.app/api/oauth/ghl/callback
GHL_SCOPES=contacts.readonly,contacts.write,custom-fields.readonly,custom-fields.write,locations.readonly,opportunities.write,webhooks.readonly,webhooks.write

# Shared secret do app no Marketplace (autentica INSTALL/UNINSTALL)
GHL_MARKETPLACE_SHARED_SECRET=xxxxxxxxxxxx

# Apenas se for testar SSO/Custom Menu (US5)
GHL_SSO_JWKS_URL=https://services.leadconnectorhq.com/.well-known/jwks.json

# Já existente em .env.local — não duplicar
PATIENT_DATA_ENCRYPTION_KEY=...
```

> **Nunca** comitar `.env.local`. Os defaults publicáveis estão em `.env.example` (atualizar com placeholders).

---

## 3. Fluxo completo (manual via UI)

1. Abrir `http://localhost:3000` e logar como **admin** de um tenant existente (ou seedar via `pnpm seed`).
2. Ir em **Configurações → Integrações → GoHighLevel**.
3. Clicar em **Conectar ao GoHighLevel** → redirect para `https://marketplace.gohighlevel.com/oauth/chooselocation?...`.
4. Escolher uma sub-account de teste, autorizar.
5. GHL redireciona para `https://<seu-tunel>.ngrok-free.app/api/oauth/ghl/callback?code=...&state=...`.
6. Depois do callback, voltar para `/configuracoes/integracoes/ghl?status=connected`.
7. Validações esperadas na página:
   - Badge **Conectado**.
   - Nome da sub-account, data de conexão.
   - Lista de **6 custom fields** (CPF, Plano de Saúde, ...) — todos com `id: cf_...`.
   - Lista de **3 webhooks** (ContactCreate, ContactUpdate, OpportunityStatusUpdate).
   - Seção "Custom Menu" com `registered` ou `unsupported` (depende da API atual do GHL — research item 5).
   - Sync log mostra `connect` (success), `custom_field_setup` (×6), `webhook_setup` (×3), `custom_menu_setup` (success/unsupported).
8. Verificações no banco (psql Supabase local):

```sql
SELECT tenant_id, provider, status, enabled, location_id, connected_at
  FROM tenant_integrations
 WHERE provider='ghl';

SELECT kind, status, occurred_at
  FROM integration_sync_log
 WHERE provider='ghl'
 ORDER BY occurred_at DESC
 LIMIT 20;

SELECT event_type, motivo, created_at
  FROM audit_log
 WHERE entidade='tenant_integrations'
 ORDER BY created_at DESC
 LIMIT 5;
```

---

## 4. Simular Marketplace install (sem precisar de UI)

Depois que o tunel está no ar, simular o webhook que o GHL Marketplace dispararia em uma instalação real.

```bash
TUNNEL=https://xxxxx.ngrok-free.app
SECRET=$GHL_MARKETPLACE_SHARED_SECRET
TS=$(date +%s)
BODY='{
  "eventId":"evt_test_001",
  "type":"INSTALL",
  "appId":"app_prontool_test",
  "companyId":"comp_abc",
  "locationId":"loc_test_001",
  "location":{"id":"loc_test_001","name":"Clinica Teste","timezone":"America/Sao_Paulo","countryCode":"BR"},
  "user":{"id":"usr_001","email":"admin@clinica.test","firstName":"Ana","lastName":"Lima","type":"Location"},
  "tokens":{"access_token":"at_dev_001","refresh_token":"rt_dev_001","expires_in":86400,"scope":"contacts.readonly contacts.write"},
  "installedAt":"2026-05-04T15:00:00Z"
}'

# HMAC do raw body
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $2}')

curl -X POST "$TUNNEL/api/webhooks/ghl/install" \
  -H "content-type: application/json" \
  -H "x-wh-signature: $SIG" \
  -H "x-wh-timestamp: $TS" \
  --data-raw "$BODY"
# Esperado: 200 { "received": true, "duplicate": false, "tenant_id": "..." }
```

Confirma que:

- `tenants` tem novo registro com nome "Clinica Teste".
- `tenant_integrations(provider='ghl', location_id='loc_test_001')` existe com `status='connected'`.
- `audit_log` tem `integration.connect` com `actor='system:ghl_marketplace_install'`.
- `integration_sync_log` tem `kind='connect' status='success'`.

Reenviar o mesmo curl → deve retornar `{ "received": true, "duplicate": true }` sem criar tenants extras.

Para uninstall:

```bash
BODY='{"eventId":"evt_test_002","type":"UNINSTALL","appId":"app_prontool_test","companyId":"comp_abc","locationId":"loc_test_001","uninstalledAt":"2026-05-04T16:00:00Z","reason":"user_request"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $2}')
TS=$(date +%s)
curl -X POST "$TUNNEL/api/webhooks/ghl/uninstall" \
  -H "content-type: application/json" \
  -H "x-wh-signature: $SIG" \
  -H "x-wh-timestamp: $TS" \
  --data-raw "$BODY"
```

Verifica `tenant_integrations.enabled=false`, `status='disconnected'`, pacientes preservados.

---

## 5. Test suites

```bash
# Contract suites (rápidas, MSW para GHL externo)
pnpm test:contract -- oauth-ghl
pnpm test:contract -- marketplace-webhooks
pnpm test:contract -- ghl-config-detail
pnpm test:contract -- sso-ghl
pnpm test:contract -- integration-adapter   # genérico, deve continuar passando

# Integration suites (DB local)
pnpm test:integration -- ghl/oauth-flow
pnpm test:integration -- ghl/marketplace-install
pnpm test:integration -- ghl/auto-refresh
pnpm test:integration -- ghl/custom-fields-setup
pnpm test:integration -- ghl/sync-bidirectional

# Lint:auth — confirma que GHL_* env só é lida em src/lib/integrations/ghl/oauth/
pnpm lint:auth

# Typecheck
pnpm typecheck
```

---

## 6. Como lidar com tenants legacy (Feature 002)

Tenants criados antes do deploy desta feature aparecem com banner "Reconexão necessária" na página `/configuracoes/integracoes/ghl`. Para migrar um tenant em dev:

1. Logar como admin desse tenant.
2. Clicar em **Reconectar** (mesmo botão "Conectar"). Fluxo OAuth 2.0 padrão.
3. Após o callback, `tenant_integrations.credentials_enc` é sobrescrito pelo formato OAuth (sem `operations_pat`).

Não há job de migração em massa em v1 — cada admin reconecta na primeira oportunidade.

---

## 7. Troubleshooting

| Sintoma                                | Causa provável                                                                                       | Como resolver                                                                                                                   |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `OAUTH_CONFIG_MISSING` em `/authorize` | Falta `GHL_CLIENT_ID/SECRET/REDIRECT_URI/SCOPES` em `.env.local`                                     | Confirmar e `pnpm dev` again.                                                                                                   |
| `STATE_MISMATCH` no callback           | Cookie SameSite bloqueado por extensão / browser. Túnel ngrok vs localhost diferem (cookie HostOnly) | Usar a URL do ngrok consistentemente para iniciar e finalizar o flow.                                                           |
| `INVALID_SIGNATURE` em `/install`      | Body sendo modificado por proxy / charset diferente                                                  | Garantir que `BODY` no curl é byte-idêntico ao que o handler recebe. Se necessário, log raw body antes do verify para comparar. |
| Custom fields setup falha em loop      | `LARGE_TEXT` rejeitado pela API atual                                                                | Verificar tipo aceito (research item 6) e ajustar em `custom-fields-setup.ts`.                                                  |
| Tokens cifrados aparecem em log        | Bug de redaction                                                                                     | Inspecionar `pino` formatter; nunca logar o objeto `creds` direto.                                                              |

---

## 8. Cleanup

```bash
# Resetar tudo localmente (apaga dados!)
pnpm supabase:reset
```

Para Marketplace de produção: feature de "uninstall" deve ser sempre testada antes de deploy — uma desinstalação errada não deleta dados, mas deixa pacientes órfãos do GHL até reconexão.

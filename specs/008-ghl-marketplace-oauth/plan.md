# Implementation Plan: Integração Prontool ↔ GoHighLevel Marketplace (OAuth 2.0)

**Branch**: `008-ghl-marketplace-oauth` | **Date**: 2026-05-04 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `C:\My project\specs\008-ghl-marketplace-oauth\spec.md`

## Summary

Migrar a integração GHL de "token fixo + proxy compartilhado em Homio Operations" para **OAuth 2.0 oficial do GHL Marketplace** com tokens **per-tenant** armazenados criptografados em `tenant_integrations`. Publicar o Prontool como app instalável: o webhook `INSTALL` cria o tenant automaticamente, registra os 6 custom fields clínicos, registra os webhooks de contato e (opcionalmente) o item de Custom Menu para SSO via iframe. Manter o pattern do adapter registry (Feature 002) — só o adapter `src/lib/integrations/ghl/` muda; o core continua emitindo `DomainEvent`s genéricos.

Pontos-chave da arquitetura:

- **OAuth client per-tenant**: cada `tenant_integrations(provider='ghl')` carrega `access_token + refresh_token + expires_at + scopes` cifrados. Adapter chama `services.leadconnectorhq.com` **diretamente** com `Authorization: Bearer`. O proxy compartilhado em Homio Operations (`SUPABASE_OPERATIONS_URL`) **deixa de ser usado** para o caminho GHL → Operations vira código legado de outra integração.
- **Token middleware dedicado**: `withGhlAuth(supabase, tenantId)` retorna `{ accessToken, locationId }` válidos no momento da chamada — internamente faz refresh se faltar < 60 s para expirar, com lock por `tenant_integrations.id` para serializar refreshes concorrentes (Postgres advisory lock + retry).
- **Marketplace lifecycle**: rotas novas `/api/oauth/ghl/{authorize,callback}` para conexão manual e `/api/webhooks/ghl/{install,uninstall}` para o Marketplace. Ambas chegam ao mesmo `connectGhlTenant()` core que cria/atualiza o registro, dispara o **post-connect setup** (custom fields + webhooks + custom menu) e registra `audit_log`.
- **Setup pós-conexão idempotente**: para cada um dos 6 custom fields, busca por nome + tipo na sub-account, reutiliza match exato, sufixa `" (Prontool)"` em divergência de tipo, cria do zero quando ausente. Webhooks são registrados pelo nome do evento (replace se já existir). Custom Menu é best-effort com fallback gracioso.
- **Sync log per-tenant**: nova tabela leve `integration_sync_log` (append-only, últimos N por tenant) alimenta o componente "últimas 10 operações" da UI sem precisar varrer `audit_log`.
- **Resiliência transversal**: nenhuma falha contra o GHL bloqueia operação local. Refresh fail / 401 / 5xx → marcar status `token_expired` ou `degraded`, alerta `integration_sync_failed` com `detail.provider='ghl'`, próxima conexão "Reconectar" recompõe.

Ordem de entrega (mapa para `/speckit.tasks` mais à frente):

- **P1**: schema + módulo OAuth (`/authorize`, `/callback`) + estado "Conectado/Desconectado/Token expirado" na UI + auditoria. Inclui middleware `withGhlAuth` e a migration 0062.
- **P1**: webhooks `INSTALL` / `UNINSTALL` com auto-provisioning, idempotência e validação de assinatura.
- **P2**: setup pós-conexão (custom fields + webhooks de contato) + migração do adapter `handleDomainEvent` para chamar GHL direto via Bearer.
- **P2**: webhook inbound `ContactCreate`/`ContactUpdate` upserting `patients` + sync log na UI.
- **P3**: SSO `/api/sso/ghl` + tentativa de Custom Menu com fallback "configurar manualmente" na UI.

## Technical Context

**Language/Version**: TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel).
**Primary Dependencies**: Next.js 14.2 (App Router), `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23 (schemas OAuth + payloads webhook), Pino 9, React 18.3, shadcn/ui (Radix), TailwindCSS 3.4. **Sem novas deps de runtime** — `fetch` nativo + `AbortSignal.timeout(5000)` para chamadas GHL; `crypto.randomUUID` + `crypto.timingSafeEqual` para state/csrf e verificação de assinatura.
**Storage**: PostgreSQL via Supabase (local: `supabase start` :54321) com RLS por `tenant_id`. **Tabelas tocadas**: `tenant_integrations` (acrescenta colunas `status TEXT`, `connected_at TIMESTAMPTZ`, `location_id TEXT GENERATED ALWAYS AS (config->>'location_id') STORED` para índice unique), `audit_log` (uso, sem schema change), `alerts` (uso). **Tabelas novas**: `integration_sync_log` (append-only, retenção das últimas 10 entradas por tenant×provider via trigger). **Migration nova**: `0062_ghl_oauth_marketplace.sql`. Catálogo de custom fields é dado externo (sub-account GHL) — IDs persistidos em `tenant_integrations.config.custom_field_ids`.
**External APIs**: `services.leadconnectorhq.com` v2 — `POST /oauth/token` (code → tokens, refresh_token → tokens), `POST /custom-fields/`, `GET /custom-fields/`, `POST /hooks/`, `DELETE /hooks/{id}`, `POST /contacts/`, `PUT /contacts/{id}`, `POST /contacts/{id}/notes`, `POST /custom-menus/` (best-effort, ver research). Headers: `Authorization: Bearer <access_token>`, `Version: 2021-07-28` (default) ou `2023-02-21` em endpoints específicos. Tela de consentimento: `https://marketplace.gohighlevel.com/oauth/chooselocation`.
**Testing**: Vitest (unit/integration/contract em `tests/`). MSW para simular `services.leadconnectorhq.com`. Suítes novas: `tests/contract/oauth-ghl.spec.ts`, `tests/integration/integrations/ghl/oauth-flow.spec.ts`, `.../marketplace-install.spec.ts`, `.../auto-refresh.spec.ts`, `.../custom-fields-setup.spec.ts`, `.../sync-bidirectional.spec.ts`. Atualiza `tests/contract/integration-adapter.spec.ts` para refletir novo formato de credentials. Lint:auth precisa permitir leitura de `GHL_CLIENT_ID/SECRET/REDIRECT_URI/SCOPES` **somente** dentro de `src/lib/integrations/ghl/oauth/` — não dentro do `adapter.ts`.
**Target Platform**: Web (browser desktop-first) servido por Vercel Node runtime. Edge runtime não é suficiente — handlers OAuth precisam de `crypto` Node-style para enc/dec via Supabase RPC.
**Project Type**: Aplicação web Next.js (mesma estrutura monorepo única do projeto — `src/app` + `src/lib`).
**Performance Goals**: Conexão completa (consentimento → tokens → setup pós-conexão) em **< 2 min** de wall-clock para o admin (FR/SC-001). Cada chamada individual ao GHL com timeout de **5 s** e até **2 retries** com backoff. Auto-refresh acrescenta no máximo **+1 RTT** (~ 200–500 ms) na chamada que dispara — refresh em paralelo nunca duplica (lock). Webhook `INSTALL` processado em ≤ 5 s (se setup pós-conexão falhar parcialmente, completa em background sem bloquear a resposta 200 ao GHL).
**Constraints**: Zero regressão em `/api/webhooks/ghl` atual (back-compat). RLS/RBAC em todas as rotas novas (`requireRole('admin')` para `/api/oauth/ghl/*` e UI; webhooks Marketplace usam validação de assinatura + service-role client). Tokens **MUST** ficar cifrados em `credentials_enc` via `enc_text_with_key`; **MUST NOT** aparecer em response bodies, HTML, atributos, JSON inline ou logs. PII (LGPD): nenhum dado pessoal extra é persistido por essa feature além do que já passa pelo flow de pacientes. Financeiro append-only: feature **não toca** em `appointments`, `expenses` ou tabelas financeiras — só em `tenant_integrations` + log de sync. Moeda: irrelevante (sem operação financeira nova).
**Scale/Scope**: Dezenas de tenants ativos no Marketplace em t+12m. Estimativa: ~ 8 arquivos novos em `src/lib/integrations/ghl/oauth/`, 4 rotas API novas, 1 página atualizada, 1 migration, ~ 6 suítes de teste. Refactor não-trivial em `src/lib/integrations/ghl/{adapter,create-contact,create-note}.ts` (substituir proxy compartilhado por chamada direta autenticada).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Aplicação nesta feature | Status |
|-----------|-------------------------|--------|
| **I. Integridade Financeira Imutável** | Feature **não toca** registros financeiros — não muta `appointments`, `expenses` nem versões de preço. Notas no GHL são derivadas de eventos já commitados (`appointment.created`); falha em criá-las nunca volta atrás. `integration_sync_log` é append-only por trigger. | ✅ PASS |
| **II. Auditabilidade Total de Preços** | Toda operação relevante registra `audit_log`: `integration.connect`, `integration.reconfigure`, `integration.disconnect`, `integration.refresh_success`, `integration.refresh_failed`, com `actor`, `tenant_id`, `valor_anterior`/`valor_novo` (status quando muda), `motivo` (`marketplace_install`, `manual_connect`, `token_refresh_failed`), `origem_da_requisição`. Webhooks Marketplace registram `actor=system:ghl_marketplace`. | ✅ PASS |
| **III. Isolamento Multi-Tenant** | `tenant_integrations` mantém RLS existente (`tenant_id = jwt_tenant_id()`, write `admin`). Novo índice unique `tenant_integrations_unique_location_id` previne duas linhas com mesma `location_id` (cross-tenant collision). Webhooks Marketplace correm com **service-role client** mas resolvem `tenant_id` exclusivamente pela `location_id` do payload validado por assinatura — nenhuma rota de usuário pode escapar do tenant da sessão. Adapter recebe `AdapterContext` com `tenantId` e nunca lê `tenant_id` de outro lugar. | ✅ PASS |
| **IV. Conformidade TUSS/ANS** | Sync de contato/atendimento → GHL não fala TUSS — só transporta o código já validado pelo core. Inbound `ContactCreate`/`ContactUpdate` cria/atualiza paciente; **não** cria atendimento (atendimento continua passando pelo fluxo manual / `appointment.created` que valida TUSS). | ✅ PASS |
| **V. RBAC** | `requireRole('admin')` em `/api/oauth/ghl/{authorize,callback}` e em `/api/configuracoes/integracoes/ghl` (POST/DELETE). UI esconde botões para não-admin **e** servidor rejeita. SSO endpoint `/api/sso/ghl` valida token de contexto do GHL antes de criar sessão; sessão criada herda papel do usuário Prontool correspondente. Negações registradas em `audit_log` (helper `audit/deny.ts` existente). | ✅ PASS |

**Resultado**: GATE PASS. Nenhuma violação. Complexity Tracking abaixo fica vazio.

### Re-check após Phase 1 design

Reavaliado após o design (Phase 1):

- Princípio I: confirmado — `data-model.md` mostra que `integration_sync_log` tem trigger `BEFORE UPDATE/DELETE` que `RAISE EXCEPTION`, e `tenant_integrations` continua tendo apenas updates de campos não-financeiros. ✅
- Princípio II: contracts/oauth-ghl.md detalha cada `audit_log` emitido em conectar/refresh/desconectar, atendendo ao mínimo do Principle II. ✅
- Princípio III: contracts/marketplace-webhooks.md exige verificação de assinatura **antes** de qualquer SQL e bloqueia processamento se a `location_id` do payload já estiver mapeada a tenant cuja conexão pertence a outro `created_by_user_id` ou cujo `enabled=false` foi por desconexão manual recente — neutraliza takeover via INSTALL falsificado. ✅
- Princípio IV: confirmado — nenhum endpoint dessa feature aceita códigos TUSS arbitrários. ✅
- Princípio V: confirmado — UI re-renderiza sem botões de ação para não-admin (testado em `tests/integration/integrations/ghl/oauth-flow.spec.ts`). ✅

GATE PASS pós-design.

## Project Structure

### Documentation (this feature)

```text
specs/008-ghl-marketplace-oauth/
├── plan.md                              # This file
├── spec.md                              # Feature specification
├── research.md                          # Phase 0 — OAuth flow, refresh strategy, custom menu viability
├── data-model.md                        # Phase 1 — schema delta + log table + config keys
├── quickstart.md                        # Phase 1 — local dev path (supabase start + ngrok)
├── contracts/
│   ├── oauth-ghl.md                     # /api/oauth/ghl/{authorize,callback} contract
│   ├── marketplace-webhooks.md          # /api/webhooks/ghl/{install,uninstall} contract
│   ├── ghl-config-detail.md             # /api/configuracoes/integracoes/ghl GET/POST/DELETE
│   ├── sso-ghl.md                       # /api/sso/ghl contract (US5)
│   └── ghl-adapter-v2.md                # IntegrationAdapter<GhlConfigV2, GhlOAuthCredentials>
├── checklists/
│   └── requirements.md                  # Existing
└── tasks.md                             # Phase 2 (/speckit.tasks output — NOT created here)
```

### Source Code (repository root)

```text
src/
├── app/
│   ├── (dashboard)/
│   │   └── configuracoes/
│   │       └── integracoes/
│   │           └── [provider]/
│   │               ├── page.tsx                          # MODIFIED — quando provider==='ghl', renderiza GhlOAuthPanel
│   │               ├── provider-form.tsx                 # EXISTING — caminho legado para outros providers
│   │               └── ghl-oauth-panel.tsx               # NEW — Conectar/Reconectar/Desconectar + sync log + custom fields/webhooks status
│   └── api/
│       ├── oauth/
│       │   └── ghl/
│       │       ├── authorize/route.ts                    # NEW — GET (admin) → redirect to chooselocation
│       │       ├── callback/route.ts                     # NEW — GET → exchange code, persist tokens, kick post-connect
│       │       └── refresh/route.ts                      # NEW — POST internal-only (CSRF-protected), opcional para admin "forçar refresh"
│       ├── webhooks/
│       │   └── ghl/
│       │       ├── route.ts                              # MODIFIED — continua thin-forward para adapter; adiciona discriminação ContactCreate/ContactUpdate
│       │       ├── install/route.ts                      # NEW — POST Marketplace install
│       │       └── uninstall/route.ts                    # NEW — POST Marketplace uninstall
│       ├── sso/
│       │   └── ghl/route.ts                              # NEW — GET valida token de contexto + cria sessão
│       └── configuracoes/
│           └── integracoes/
│               └── ghl/
│                   ├── route.ts                          # NEW — GET status + POST reconfigurar (não-creds) + DELETE desconectar
│                   └── sync-log/route.ts                 # NEW — GET últimas 10 operações
├── lib/
│   ├── core/
│   │   ├── integrations/
│   │   │   ├── credentials.ts                            # EXISTING — sem mudança
│   │   │   ├── config.ts                                 # EXISTING — sem mudança
│   │   │   └── ghl/
│   │   │       ├── connect-tenant.ts                     # NEW — único caminho de upsert tenant_integrations(provider='ghl', tokens)
│   │   │       ├── disconnect-tenant.ts                  # NEW — limpa webhooks GHL, marca enabled=false, status='disconnected'
│   │   │       ├── post-connect-setup.ts                 # NEW — orquestra custom-fields + webhooks + custom-menu (best-effort)
│   │   │       └── sync-log.ts                           # NEW — recordSyncSuccess/recordSyncFailure
│   │   └── audit/
│   │       └── integration-events.ts                     # MODIFIED — acrescenta refresh_success/refresh_failed
│   └── integrations/
│       └── ghl/
│           ├── adapter.ts                                # MODIFIED — usa withGhlAuth, troca proxy por chamadas diretas
│           ├── create-contact.ts                         # MODIFIED — POST /contacts com Bearer; retorna ghlContactId
│           ├── create-note.ts                            # MODIFIED — POST /contacts/{id}/notes com Bearer
│           ├── update-contact.ts                         # NEW — PUT /contacts/{id} com Bearer + custom_fields
│           ├── extract-custom-fields.ts                  # EXISTING — sem mudança (parsing de payload inbound)
│           ├── verify-signature.ts                       # EXISTING — usado por /api/webhooks/ghl
│           └── oauth/
│               ├── client.ts                             # NEW — exchangeCodeForTokens, refreshTokens, fetch helper com retry+timeout
│               ├── with-auth.ts                          # NEW — withGhlAuth(supabase, tenantId) → { accessToken, locationId, tokenJustRefreshed }
│               ├── token-store.ts                        # NEW — read/write tokens cifrados em tenant_integrations
│               ├── refresh-lock.ts                       # NEW — pg_advisory_xact_lock(tenant_integrations.id) para serializar refreshes
│               ├── verify-marketplace-signature.ts       # NEW — HMAC do GHL Marketplace para INSTALL/UNINSTALL
│               ├── verify-sso-token.ts                   # NEW — valida token de contexto do GHL para SSO
│               ├── custom-fields-setup.ts                # NEW — idempotente: lista, decide reuse/sufixo/criar
│               ├── webhooks-setup.ts                     # NEW — registra ContactCreate/ContactUpdate/OpportunityStatusUpdate
│               ├── custom-menu-setup.ts                  # NEW — best-effort, fallback gracioso
│               └── env.ts                                # NEW — leitura ÚNICA de GHL_CLIENT_ID/SECRET/REDIRECT_URI/SCOPES (lint:auth allowlists isso)
└── tests/                                                # ver Testing acima

supabase/
└── migrations/
    └── 0062_ghl_oauth_marketplace.sql                    # NEW — colunas tenant_integrations.status/connected_at/location_id, integration_sync_log, índices, RLS
```

**Structure Decision**: Mantém a estrutura monolítica do Next.js App Router já estabelecida nas features 002–007. A novidade é o subpacote **`src/lib/integrations/ghl/oauth/`** — cápsula que isola toda a complexidade OAuth/Marketplace e é o **único** lugar autorizado a ler `process.env.GHL_*` (regra reforçada por `lint:auth`). O adapter `src/lib/integrations/ghl/adapter.ts` continua sendo o ponto de entrada do registry; ele agora delega autenticação para `withGhlAuth` e fala direto com `services.leadconnectorhq.com` em vez do proxy. O fluxo Marketplace (install/uninstall) e o fluxo manual (authorize/callback) **convergem** em `connect-tenant.ts` → garante que ambos os caminhos dão o mesmo estado final, sem duplicar lógica de upsert + setup. Direção de dependência preservada: `core/` → `integrations/ghl/oauth/` → APIs externas. `core/` nunca importa `oauth/*` diretamente; apenas `connect-tenant.ts` / `disconnect-tenant.ts` que abstraem o subpacote.

## Phase 0: Outline & Research

Tópicos despachados para `research.md`:

1. **Fluxo OAuth oficial do GHL Marketplace** — confirmar exato endpoint do `chooselocation`, parâmetros aceitos (`response_type`, `loginWindowOpenMode`, `userType=Location`?), formato de resposta de `POST /oauth/token` (campos `access_token`, `refresh_token`, `expires_in`, `scope`, `userType`, `locationId`, `companyId`, `userId`), TTL típico (~24h access, ~365d refresh — confirmar). Decisão: usar `response_type=code` + `userType=Location`; armazenar `expires_at = now + expires_in - 60s`.
2. **Estratégia de refresh** — políticas observadas (rotacionar refresh_token a cada chamada vs. estático). Decisão: tratar como "refresh_token pode rotacionar"; sempre persistir o par retornado pelo `/oauth/token`. Lock via `pg_advisory_xact_lock(hashtext(tenant_integrations.id::text))` na transação que abre o refresh; outras concorrentes esperam, releem o registro, e se já está fresh seguem direto.
3. **Validação de assinatura do Marketplace** — descobrir cabeçalho de assinatura (`x-wh-signature`?), algoritmo (HMAC-SHA256 sobre raw body com `GHL_MARKETPLACE_SHARED_SECRET`?), campo de timestamp para janela anti-replay. Decisão default: HMAC-SHA256, janela 5 min, segredo em `GHL_MARKETPLACE_SHARED_SECRET`. **Documentar como NEEDS-VERIFICATION em research.md** caso a documentação oficial difira.
4. **Idempotência de INSTALL** — qual chave do payload garante unicidade do evento? `eventId`? `(locationId, installedAt)`? Decisão: usar `eventId` quando presente em `raw_webhook_events.external_event_id`; cair para hash do payload se ausente. Reusa `ingest-raw-event.ts`.
5. **Custom Menu API** — verificar se hoje a API expõe `POST /custom-menus/` (ou similar). Decisão se não for possível: fallback com texto na UI ("crie manualmente apontando para X"). Implementação **não bloqueia** o resto da conexão em nenhum cenário.
6. **Custom Field type taxonomy** — confirmar nomes de tipo aceitos pelo GHL v2: `TEXT`, `LARGE_TEXT` (v.s. `TEXT_LONG`), `DATE`, `NUMBER`, `PHONE`, etc. Decisão: tabela definitiva em research.md mapeando o campo Prontool → tipo GHL v2 oficial.
7. **SSO context token** — formato (JWT? opaco?), claims esperados (`locationId`, `userId`, `companyId`, `userType`), endpoint de verificação. Default assumption: JWT assinado com `GHL_SSO_PUBLIC_KEY`; fallback para chamada `GET /users/{id}` se necessário.
8. **Webhook `OpportunityStatusUpdate`** — confirmar se ainda é gatilho oficial ou foi substituído por `Opportunity` genérico (Feature 002 já registrava). Decisão se houver mudança: ajustar lista, manter compat.
9. **Coexistência com proxy Homio Operations** — política para tenants que ainda têm `credentials_enc` no formato antigo (`operations_pat`). Decisão: migration **não** apaga creds antigas; admin precisa Reconectar uma vez para obter par OAuth novo. Tela de configuração mostra estado "Reconexão necessária" para tenants ainda no formato antigo.

**Saída**: `research.md` com Decision/Rationale/Alternatives para cada item acima. Itens 3, 5 e 7 podem terminar com `**STATUS: needs-verification-against-official-docs**` documentando o default escolhido e linkando para o trecho da doc do GHL que precisa ser confirmado antes da PR final.

## Phase 1: Design & Contracts

**Pré-requisitos**: research.md completo (em particular itens 1–4 fechados; 5 e 7 podem ficar como "verify-on-implement" sem bloquear o design).

1. **`data-model.md`**:
   - **Migration `0062_ghl_oauth_marketplace.sql`**:
     - `ALTER TABLE tenant_integrations ADD COLUMN status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','disconnected','token_expired'))`. Coluna unifica com `enabled` (`enabled=true AND status='connected'` é o único caminho ativo).
     - `ALTER TABLE tenant_integrations ADD COLUMN connected_at TIMESTAMPTZ NOT NULL DEFAULT now()`.
     - `ALTER TABLE tenant_integrations ADD COLUMN location_id TEXT GENERATED ALWAYS AS ((config->>'location_id')) STORED`. Índice unique parcial: `WHERE location_id IS NOT NULL AND provider = 'ghl' AND enabled = true`.
     - `CREATE TABLE integration_sync_log (id UUID PK, tenant_id UUID NOT NULL, provider TEXT NOT NULL, occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(), kind TEXT NOT NULL CHECK (kind IN ('outbound_contact','outbound_note','outbound_update','inbound_contact','token_refresh','custom_field_setup','webhook_setup','custom_menu_setup','disconnect')), status TEXT NOT NULL CHECK (status IN ('success','failure')), error_code TEXT, error_message TEXT, detail JSONB)`. RLS por tenant.
     - Trigger `integration_sync_log_immutable` (`BEFORE UPDATE OR DELETE`) que `RAISE EXCEPTION`. Retenção: trigger `AFTER INSERT` que mantém só as 100 mais recentes por `(tenant_id, provider)` (corte simples para não inflar).
   - **Schema TS**:
     - `GhlOAuthCredentials = { access_token: string; refresh_token: string; expires_at: string /*ISO*/; scopes: string[]; userType: 'Location'|'Company'; locationId: string; companyId: string; userId: string }`.
     - `GhlConfigV2 = { location_id: string; sub_account_name: string; timezone: string|null; custom_field_ids: Record<'cpf'|'plano_saude'|'profissional_responsavel'|'ultimo_atendimento'|'diagnosticos_ativos'|'alergias', { id: string; alias: string }>; webhook_ids: Record<'ContactCreate'|'ContactUpdate'|'OpportunityStatusUpdate', string>; menu_id: string|null; menu_status: 'registered'|'unsupported'|'failed' }`.
     - Manter `legacy_operations_pat?: string` em credentials só para tenants migrados; setter remove ao primeiro reconnect.
   - **Estados de UI** derivados:
     - `not_connected`: nenhum row em `tenant_integrations` para `(tenant, 'ghl')` **ou** `enabled=false AND status='disconnected'`.
     - `connected`: `enabled=true AND status='connected'`.
     - `token_expired`: `status='token_expired'` (refresh falhou).
   - Documenta também invariantes de integridade (`location_id` único por tenant ativo; `status='token_expired'` só transiciona para `'connected'` via Reconectar; nunca há duas linhas `(tenant_id,'ghl')` graças ao PK existente).

2. **`contracts/`** (markdown contract docs alinhadas ao formato de `specs/002-ghl-optional-standalone/contracts/*`):
   - **`oauth-ghl.md`**: contratos de `GET /api/oauth/ghl/authorize` (admin only, gera `state` HMAC, redirect 302 para `chooselocation`) e `GET /api/oauth/ghl/callback` (valida `state`, troca `code`, persiste tokens, dispara post-connect, redireciona para `/configuracoes/integracoes/ghl?status=connected`). Erros: `state_mismatch`, `code_exchange_failed`, `setup_partial` (continua mas mostra warnings).
   - **`marketplace-webhooks.md`**: contratos de `POST /api/webhooks/ghl/install` e `POST /api/webhooks/ghl/uninstall`. Validação de assinatura, parsing do payload, idempotência por `eventId`, criação/atualização de tenant via `connect-tenant.ts`, ack 200 mesmo em retry. UNINSTALL corre `disconnect-tenant.ts`.
   - **`ghl-config-detail.md`**: contratos de `GET /api/configuracoes/integracoes/ghl` (retorna `{ status, sub_account_name, connected_at, custom_fields: [{name, id, alias}], webhooks: [{event, id}], menu_status, last_sync_at }` — nunca tokens), `POST /api/configuracoes/integracoes/ghl` (apenas reconfigurações que não alteram credenciais — mantido para back-compat legado), `DELETE /api/configuracoes/integracoes/ghl` (admin → `disconnect-tenant.ts`). `GET /api/configuracoes/integracoes/ghl/sync-log` retorna últimas 10 entradas.
   - **`sso-ghl.md`**: contrato de `GET /api/sso/ghl?context_token=...` — valida token, identifica tenant pela `location_id`, cria sessão (cookie HttpOnly), responde com redirect 302 para `/`. CSP/headers permitem iframe pelo domínio `app.gohighlevel.com` (e variantes documentadas em research).
   - **`ghl-adapter-v2.md`**: novo formato de `IntegrationAdapter<GhlConfigV2, GhlOAuthCredentials>`. `handleDomainEvent` agora pega `accessToken` via `withGhlAuth` em vez de proxy creds. `redactCredentials` retorna `{ access_token: '***', refresh_token: '***' }`. Suite contract abstrata (`tests/contract/integration-adapter.spec.ts`) passa sem mudança no shape.

3. **`quickstart.md`**:
   - Setup local: `supabase start` + `pnpm dev` + ngrok para receber webhooks Marketplace.
   - Vars a definir em `.env.local`: `GHL_CLIENT_ID`, `GHL_CLIENT_SECRET`, `GHL_REDIRECT_URI=http://localhost:3000/api/oauth/ghl/callback`, `GHL_SCOPES=...`, `GHL_MARKETPLACE_SHARED_SECRET`, `PATIENT_DATA_ENCRYPTION_KEY` (já existente).
   - Roteiro: (a) criar app de teste no GHL Marketplace Sandbox; (b) configurar redirect URI = ngrok-url; (c) clicar em Conectar na UI; (d) verificar `tenant_integrations` row + sync log; (e) simular INSTALL via `curl -X POST` com payload + assinatura HMAC; (f) verificar tenant criado; (g) simular UNINSTALL.
   - Comandos: `pnpm test:contract -- oauth`, `pnpm test:integration -- ghl`, `pnpm lint:auth` (deve passar com novos paths), `pnpm supabase:reset` (aplica 0062), `pnpm supabase:gen-types`.

4. **Agent context update**:
   - Rodar `.specify/scripts/powershell/update-agent-context.ps1 -AgentType claude` para acrescentar a nova feature 008 ao bloco "Active Technologies" do `CLAUDE.md`. Não há tecnologias novas — só novas tabelas (`integration_sync_log`) e nova migration (`0062_ghl_oauth_marketplace.sql`); script preservará entradas existentes.

**Saída**: `data-model.md`, `contracts/{oauth-ghl,marketplace-webhooks,ghl-config-detail,sso-ghl,ghl-adapter-v2}.md`, `quickstart.md`, atualização de `CLAUDE.md`.

## Complexity Tracking

> Nenhuma violação de constituição que precise justificativa. A nova subpasta `oauth/` aumenta o número de arquivos, mas é o oposto de complexidade injustificada — encapsula segredos OAuth fora do adapter (resolve a regra `lint:auth`) e mantém o contrato `IntegrationAdapter` inalterado para o registry.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| —         | —          | —                                   |

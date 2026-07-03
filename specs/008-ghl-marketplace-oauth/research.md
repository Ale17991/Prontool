# Phase 0 — Research: Integração GHL Marketplace (OAuth 2.0)

**Feature**: `008-ghl-marketplace-oauth`
**Date**: 2026-05-04
**Scope**: resolver decisões abertas antes do design e listar pontos que precisam ser confirmados contra a documentação oficial do GHL Marketplace antes da PR final.

> Convenções:
>
> - **STATUS: locked** — decisão final, não bloquear `/speckit.tasks`.
> - **STATUS: needs-verification-against-official-docs** — default razoável escolhido com base em padrões do GHL e em integrações análogas; precisa confirmar contra a doc oficial do Marketplace antes de mergear a PR final, mas o design abaixo absorve a verificação sem reescrita.

---

## 1. Fluxo OAuth 2.0 do GHL Marketplace

**Decision**: Usar `response_type=code` no endpoint público `https://marketplace.gohighlevel.com/oauth/chooselocation` com query string contendo `client_id`, `redirect_uri`, `scope` (CSV) e `state` (HMAC do tenant + nonce). Redirect de volta cai em `GET /api/oauth/ghl/callback?code=...&state=...`. Backend troca por tokens via `POST https://services.leadconnectorhq.com/oauth/token` com `grant_type=authorization_code`, `client_id`, `client_secret`, `redirect_uri`, `code`, `user_type=Location`. Resposta esperada: `{ access_token, refresh_token, expires_in (segundos), scope, userType, locationId, companyId, userId }`.

**Persistência**: `expires_at = nowUTC + (expires_in - 60s)` para criar uma janela de segurança contra clock skew. Tokens são serializados como JSON e cifrados via `enc_text_with_key` igual ao restante de `tenant_integrations.credentials_enc`.

**Rationale**: `chooselocation` é o endpoint oficial documentado para que o admin escolha a sub-account explicitamente; alternativa `/oauth/authorize` direta é para fluxos mais antigos e não suporta o seletor de location. Manter offset de 60s evita falhas em chamadas que cruzam o instante exato do vencimento (o GHL retornaria 401 antes do refresh disparar).

**Alternatives considered**:

- **Implicit flow** — descartado, OAuth 2.1 desencoraja; também não retorna `refresh_token`.
- **Confidential client com auth básico** — algumas APIs aceitam `Authorization: Basic` no `/oauth/token`; mais flexível mas adiciona um vetor a mais. Mantemos credenciais no body para alinhar à doc oficial v2 do GHL.
- **Cifrar tokens com KMS dedicado** (em vez do `enc_text_with_key` existente) — mais seguro em teoria mas quebra simetria com o resto de `credentials_enc`. Custo > benefício para v1.

**STATUS: locked**

---

## 2. Estratégia de refresh

**Decision**:

- Antes de cada chamada GHL, `withGhlAuth(supabase, tenantId)` lê `expires_at`. Se `expires_at - now < 60s`, abre uma transação curta, adquire `pg_advisory_xact_lock(hashtext(tenant_integrations.tenant_id || '/' || provider))`, **rele** o registro, e só dispara refresh se ainda estiver fresco (double-check pós-lock). Refresh chama `POST /oauth/token` com `grant_type=refresh_token`, `refresh_token=<atual>`, `client_id`, `client_secret`. Persiste **o par retornado** (access **e** refresh — o GHL pode rotacionar refresh_token).
- Se a chamada GHL real responder 401 mesmo com `expires_at` válido (token revogado fora de prazo), o adapter trata como "force refresh": faz uma tentativa de refresh, repete a chamada **uma** vez. Se falhar de novo, marca `status='token_expired'`, registra `audit_log` `integration.refresh_failed`, dispara alerta `integration_sync_failed`, e retorna ao caller para que a operação local **continue com sucesso** sem o sync.
- Concorrência cross-instance: o advisory lock é **transaction-scoped**, então é liberado automaticamente ao COMMIT/ROLLBACK; outros workers que estavam esperando releem o registro e seguem com o token novo.

**Rationale**: Lock por advisory key (em vez de SELECT FOR UPDATE) evita lock-and-hold em transações longas e é barato. Double-check após adquirir o lock é a clássica defesa contra "todos acordam achando que precisam refrescar". Persistir o par retornado é defensivo: se o GHL rotacionar `refresh_token` e nós só persistirmos `access_token`, perdemos a chave do próximo refresh.

**Alternatives considered**:

- **Background pré-refresh** (cron a cada 23h pré-emptivo) — simples mas multiplica chamadas ao GHL × tenants conectados; scaling ruim. Mantemos refresh por demanda.
- **Cache em memória do access_token** (Redis/process-level) — bom para reduzir round-trips ao banco mas adiciona dependência. Hoje o banco já é o source of truth e a leitura é < 5 ms; deixamos cache para iteração futura se virar gargalo.
- **Distribuir o lock via Redis (Redlock)** — desnecessário enquanto Postgres é a única instância de coordenação. Trocar quando houver multi-region.

**STATUS: locked**

---

## 3. Validação de assinatura dos webhooks Marketplace

**Decision (default)**: HMAC-SHA256 sobre o **raw body** com chave em `process.env.GHL_MARKETPLACE_SHARED_SECRET`. Cabeçalhos esperados: `x-wh-signature` (hex lowercase) e `x-wh-timestamp` (epoch segundos). Janela anti-replay = **5 minutos**. Comparação de assinatura via `crypto.timingSafeEqual`. Falha → 401 + `audit_log` (`signature_failure_marketplace`).

**Implementação**: já temos `verify-signature.ts` para webhooks de eventos GHL pós-conexão; criamos `verify-marketplace-signature.ts` separado porque o segredo é **shared** (mesmo para todos tenants — vem do app no Marketplace, não do tenant). O segredo é lido **somente** dentro de `src/lib/integrations/ghl/oauth/env.ts` (allowlist do `lint:auth`).

**Rationale**: HMAC-SHA256 + janela 5 min é o padrão para webhooks Marketplace na maioria dos provedores GHL-like (Stripe, Shopify Apps). A janela de 5 min é suficiente para retries do GHL e curta o suficiente para mitigar replays.

**Alternatives considered**:

- **JWT assinado** (em vez de HMAC) — melhor para multi-tenant mas o GHL Marketplace tradicionalmente usa HMAC para webhooks de install/uninstall. Mantemos HMAC até confirmar.
- **Sem janela anti-replay** — vetor para adversário que captura um payload INSTALL legítimo e o reenvia. Janela 5 min mitiga.

**STATUS: needs-verification-against-official-docs**

> Antes da PR final: confirmar nome exato do header (`x-wh-signature` vs. `x-ghl-signature` vs. outro), formato (hex vs base64), e se o GHL Marketplace usa HMAC ou um esquema próprio. Se diferir, ajustar **somente** `verify-marketplace-signature.ts` — design não é afetado.

---

## 4. Idempotência de INSTALL/UNINSTALL

**Decision**: O payload do GHL Marketplace inclui um `eventId` (UUID) único por entrega; usamos como chave em `raw_webhook_events.external_event_id` (tabela existente já usada por webhooks GHL). Se ausente (cenário improvável mas possível), gerar fingerprint = `sha256(rawBody)`. Reentry com mesmo `eventId` retorna 200 imediatamente sem reprocessar (fast-path); apenas a primeira execução chega ao `connect-tenant.ts`.

**Garantia adicional**: o `connect-tenant.ts` faz `INSERT ... ON CONFLICT (tenant_id, provider) DO UPDATE SET ...` — mesmo que o fast-path falhe e dois INSERTs cheguem ao core, o resultado é o mesmo registro com últimos tokens. Custom fields setup é idempotente (item 6). Webhooks setup é idempotente (item 7).

**Rationale**: Reaproveitar `raw_webhook_events` evita criar uma segunda tabela de deduplicação. Defesa em profundidade (fast-path no webhook + ON CONFLICT no upsert) tolera falhas no fast-path sem ter side-effects ruins.

**Alternatives considered**:

- **Tabela dedicada `marketplace_install_events`** — mais explícita mas duplica capabilites de `raw_webhook_events`. Reusar é melhor.
- **Confiar só em `ON CONFLICT`** sem fast-path — funcionaria mas dispara setup pós-conexão (custom fields, webhooks) duas vezes em cenários de retry, aumentando custo e risco de hit em rate limits.

**STATUS: locked**

---

## 5. Custom Menu API (registro programático)

**Decision (default)**: Tentar `POST /custom-menus/` com `Authorization: Bearer <access_token>` e payload `{ name, url, locationId, icon }`. Se a API responder 404 / 405 / 403 (recurso indisponível ou escopo ausente), o sistema:

1. Marca `tenant_integrations.config.menu_status = 'unsupported'`.
2. Mostra na UI a seção "Custom Menu" como manual: copia-cola da URL do Prontool + screenshot do passo-a-passo.
3. **Não** falha a conexão — restante (custom fields + webhooks de contato) continua ativo.
4. Não tenta novamente a cada login do admin; só quando `Reconectar` for clicado.

Se a chamada **funcionar**, salva `menu_id` e `menu_status = 'registered'`; em desconexão chama `DELETE /custom-menus/{menu_id}`.

**Rationale**: Há indícios de que `custom-menus` é um endpoint internal/beta no GHL e nem todas as agências têm escopo para invocá-lo programaticamente. Fallback gracioso é a única postura segura — bloquear conexão ou alertar agressivamente seria má UX.

**Alternatives considered**:

- **Não tentar registrar; sempre instruir manual** — funciona e é mais simples, mas perde a oportunidade de integração realmente seamless quando a API dá certo.
- **Tentar duas vezes com escopos alternativos** — adiciona complexidade sem ganho claro.

**STATUS: needs-verification-against-official-docs**

> Antes da PR final: confirmar (a) se o endpoint existe na v2 atual, (b) qual escopo OAuth é necessário (talvez `custom-menus.write`), (c) que erros distintos retorna para "não disponível" vs "permissão insuficiente". Se o endpoint não existir, a feature degrada para fallback manual sem refatoração.

---

## 6. Custom Field type taxonomy

**Decision**: Mapeamento Prontool → tipo GHL v2:

| Campo Prontool           | Tipo GHL v2 (default) | Alias técnico                  |
| ------------------------ | --------------------- | ------------------------------ |
| CPF                      | `TEXT`                | `prontool_cpf`                 |
| Plano de Saúde           | `TEXT`                | `prontool_plano_saude`         |
| Profissional Responsável | `TEXT`                | `prontool_profissional`        |
| Último Atendimento       | `DATE`                | `prontool_ultimo_atendimento`  |
| Diagnósticos Ativos      | `LARGE_TEXT`          | `prontool_diagnosticos_ativos` |
| Alergias                 | `TEXT`                | `prontool_alergias`            |

A spec menciona `TEXT_LONG`; a API v2 do GHL na realidade chama `LARGE_TEXT`. Usaremos o nome **técnico** correto (`LARGE_TEXT`) na chamada à API; o nome **visível** continua sendo "Diagnósticos Ativos".

**Idempotência (FR-011)**: ao conectar, `custom-fields-setup.ts` faz `GET /custom-fields/?locationId=...`, indexa por `name` (case-insensitive) e por `alias`. Para cada um dos 6:

1. Se existe match com `name` E `dataType` corretos → reutiliza ID.
2. Se existe match só por `name` mas `dataType` divergente → cria novo com nome `"<name> (Prontool)"` (Q2: C); registra warning no `audit_log`.
3. Se não existe → cria com nome e tipo padrão. Salva `alias` ali também (FR-012).

**Rationale**: Usar `alias` técnico nos IDs salvos no GHL tornaria o lookup futuro idempotente independente do nome visível, mas a API atual do GHL nem sempre permite definir alias arbitrário; usamos `name` como chave de identificação e `alias` como metadata interno do Prontool.

**Alternatives considered**:

- **Sempre criar suffix no primeiro deploy para evitar qualquer colisão** — polui sub-account de admins que não tinham conflito. Pior UX.
- **Forçar nomes sempre em inglês** — viola a UX local; admin esperaria ver "CPF" e não "Tax ID".

**STATUS: locked** (lista de campos), **needs-verification** (apenas o tipo `LARGE_TEXT` se diferir do que doc atual mostrar — ajuste isolado em `custom-fields-setup.ts`).

---

## 7. SSO context token

**Decision (default)**: Quando o usuário GHL clica no Custom Menu, o GHL injeta um query param `?context_token=<JWT>` (ou similar). O backend `/api/sso/ghl` valida esse JWT contra a chave pública do GHL Marketplace (carregada de `process.env.GHL_SSO_JWKS_URL` em runtime, com cache de 1h em memória). Claims esperados: `iss`, `aud=<GHL_CLIENT_ID>`, `exp`, `locationId`, `userId`, `userType`. Após validar, o sistema busca tenant por `location_id`, busca usuário por `external_id=<userId>` ou cria mapeamento na hora se admin do tenant aprovou auto-provisioning, cria sessão Supabase e retorna 302 para `/`.

**Headers de iframe**: `Content-Security-Policy: frame-ancestors https://app.gohighlevel.com https://*.gohighlevel.com` na resposta do `/` quando o request originou via SSO. Cookie de sessão **MUST** ser `SameSite=None; Secure; HttpOnly` para funcionar dentro do iframe cross-origin.

**Rationale**: JWKS público é o padrão moderno (Stripe Connect, Salesforce Canvas). Cache de 1h equilibra rotação de chaves vs. overhead. `SameSite=None` é exigido pelo browser para cookies em iframe cross-site.

**Alternatives considered**:

- **Token opaco + endpoint de introspecção** — mais round-trips e depende de saber a URL de introspecção, que provedores SSO costumam mudar. JWKS é mais resiliente.
- **Não suportar iframe** — lista P3 do user; manteríamos endpoint para abrir em nova janela. Mais fricção para o usuário GHL, e implementação iframe não é mais cara que nova janela.

**STATUS: needs-verification-against-official-docs**

> Antes da PR final: confirmar (a) qual claim carrega a `locationId`, (b) JWKS URL pública (ou se o GHL prefere chave estática), (c) `aud` esperado. Defaults compatíveis com a maioria dos provedores OIDC.

---

## 8. Webhook events (`OpportunityStatusUpdate` etc.)

**Decision**: Lista de eventos a registrar via `POST /hooks/`:

- `ContactCreate` (sync inbound de paciente)
- `ContactUpdate` (sync inbound de mudanças)
- `OpportunityStatusUpdate` (mantido para back-compat com Feature 002 que já usava esse gatilho para criar atendimentos)

**Idempotência**: antes de criar, `GET /hooks/?locationId=...` para listar; se já existe um com o mesmo `event` E `targetUrl`, reutiliza. Se existe com targetUrl diferente, cria novo (não substitui — admin pode ter outro consumidor).

**Rationale**: `OpportunityStatusUpdate` continua sendo o canal de "atendimento aprovado" no GHL para Feature 002, e desconectar isso na migração quebraria o fluxo existente de tenants em produção. Manter idempotência por (event, targetUrl) evita pisar em hooks alheios na mesma sub-account.

**Alternatives considered**:

- **Substituir todos os hooks existentes** — destrutivo. Fora do escopo da feature.
- **Listar mas não criar até admin clicar em "Ativar webhooks"** — adiciona um passo manual sem motivo claro.

**STATUS: locked**

---

## 9. Coexistência com proxy Homio Operations (legacy)

**Decision**: Tenants já cadastrados em `tenant_integrations` com `credentials_enc` no formato antigo (`{ operations_pat, inbound_webhook_secret }`) **continuam ativos** após o deploy desta feature, mas a UI mostra um banner "Reconexão necessária — clique aqui para migrar para OAuth 2.0". Comportamento até reconectar:

- Webhooks inbound continuam validando assinatura via `inbound_webhook_secret` legado (o que o adapter faz hoje em `verify-signature.ts`).
- Outbound (criar contato/nota): falha gracioso → alerta `integration_sync_failed` com `detail.reason='legacy_credentials_oauth_required'`. Não bloqueia operação local.

A migration **não** apaga creds antigos; só acrescenta `status` (default `'connected'`) e `connected_at` (default `now()`). A primeira reconexão via OAuth chama `connect-tenant.ts`, que sobrescreve `credentials_enc` com o novo formato em uma única transação.

**Rationale**: Nenhum tenant deve perder integração no deploy. Banner de "migrar" + degradação outbound graciosa é melhor que cortar abrupto. Manter os webhooks inbound funcionando preserva o canal de criação de atendimento via opportunity status (Feature 002), que é receita.

**Alternatives considered**:

- **Forçar reconexão imediata via job de migração** — quebra para tenants offline no momento do deploy.
- **Preservar permanentemente o caminho proxy** — duplica código indefinidamente; vamos manter no máximo até 1 release pós-feature 008.

**STATUS: locked**

---

## 10. Lint:auth allowlist update

**Decision**: `pnpm lint:auth` hoje rejeita `process.env.GHL_*` em arquivos de adapter. Vamos atualizar a regra para permitir essas variáveis **somente** dentro de `src/lib/integrations/ghl/oauth/**`. Adapter (`src/lib/integrations/ghl/adapter.ts`, `create-contact.ts`, `create-note.ts`, `update-contact.ts`) **continua proibido** de ler env diretamente — ele recebe `accessToken` via `withGhlAuth`.

**Rationale**: Mantém o invariant da Feature 002 ("adapters não conhecem segredos") sem precisar criar um helper genérico para variáveis OAuth. Cápsula `oauth/` é o limite explícito.

**STATUS: locked**

---

## Consolidação

Itens **locked** (1, 2, 4, 6 lista-de-campos, 8, 9, 10) cobrem o que o design precisa para Phase 1. Itens **needs-verification** (3 header de assinatura Marketplace, 5 endpoint Custom Menu, 6 nome do tipo `LARGE_TEXT`, 7 claims do SSO) têm defaults razoáveis e são absorvidos por arquivos isolados no design — qualquer ajuste pós-verificação é local, não estrutural.

**Próximo passo**: `data-model.md` + `contracts/*` + `quickstart.md` (Phase 1).

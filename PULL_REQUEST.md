# Pronttu MVP — sistema completo de gestão clínica com integração GHL opcional

**Branch de origem**: `002-ghl-optional-standalone` &rarr; **destino**: `master`
**Inclui**: feature `001-faturamento-medico-ghl` (base completa) + feature `002-ghl-optional-standalone` (standalone parity + multi-plataforma)

**Números**:
- 73 commits &middot; 409 arquivos &middot; ~54.500 linhas adicionadas
- 49 testes de integração + contrato passando (12 suites)
- `pnpm typecheck` limpo &middot; `pnpm lint:auth` OK (43 handlers + adapters sem env direto)

---

## Sumário executivo

O Pronttu sai deste PR como um **sistema de gestão para clínicas e consultórios** com duas grandes capacidades:

1. **Core de faturamento médico** (feature 001) — tabela de preços versionada append-only, catálogo TUSS oficial, comissões por profissional, atendimentos com valores congelados, relatório mensal, pacientes com PII criptografada, auditoria completa e RBAC.
2. **Modo standalone + integrações multi-plataforma** (feature 002) — o Pronttu opera 100% independente de qualquer CRM externo, e também conecta de forma opcional ao GoHighLevel, HubSpot (placeholder), RD Station (placeholder), Pipedrive (placeholder) ou a um webhook genérico — via um *registry* de adapters pluggáveis.

## Feature 001 — Base de faturamento médico

### Isolamento multi-tenant (Constitution §III)
- Toda entidade carrega `tenant_id` (UUID) com FK para `tenants`.
- Três camadas de defesa: middleware de auth injetando `tenant_id` no JWT, RLS no banco (`tenant_id = public.jwt_tenant_id()`), e testes de contrato provando vazamento impossível entre tenants.
- Service client com guard de call-stack (`src/lib/db/supabase-service.ts`) + lint `pnpm lint:auth` que rejeita route handlers sem `requireRole`.

### Integridade financeira imutável (Constitution §I)
- Tabelas financeiras (`appointments`, `price_versions`, `appointment_reversals`, `audit_log`) são **append-only**. Triggers de banco bloqueiam `UPDATE`/`DELETE` físicos.
- Preços versionados com `valid_from`/`valid_to`; atendimentos passados continuam ligados à versão vigente no momento do atendimento. Alteração → nova versão.
- Estornos são registros novos referenciando o original (nunca edição).

### Auditabilidade total (Constitution §II)
- Tabela `audit_log` recebe toda mutação de preço, paciente, integração e ação sensível.
- Cada entrada carrega: `actor_id`, `tenant_id`, `entity`, `field`, `old_value`, `new_value`, `reason`, `ip`, `user_agent`.
- Entradas de auditoria rendem export CSV/JSON.

### TUSS/ANS (Constitution §IV)
- Catálogo TUSS versionado com vigência oficial (migrations 0037 + seed scripts para tabelas 22/19/20, com fabricante para OPME).
- Códigos retirados rejeitados em novos atendimentos; alertas `tuss_deprecated` quando uma tabela de preços referencia código descontinuado.
- Procedures referenciam tuss_codes por FK.

### RBAC (Constitution §V)
- Quatro papéis: `admin`, `financeiro`, `recepcionista`, `profissional_saude`.
- `requireRole([...])` em todas as rotas /api; denegações vão para `audit_log` via `dispatchAlert('rbac_denied')`.
- UI espelha os gates (botões ausentes para roles sem permissão) — mas a segurança de verdade é server-side.

### Pipeline GHL (inbound)
- `POST /api/webhooks/ghl` valida HMAC assinando com `tenant_ghl_config.webhook_secret_enc` (cifrado via pgcrypto).
- Payload persistido idempotentemente em `raw_webhook_events` e enfileirado em QStash.
- Worker (`process-event.ts`) resolve paciente (upsert com PII cifrada), procedure (pelo código TUSS), plano (pelo nome) e profissional (pelo identifier); congela preço + comissão vigentes; cria atendimento.
- DLQ (`/operacao/dlq`) recebe eventos que falharam + alertas operacionais.

### Observabilidade + compliance
- Logs estruturados via Pino com redaction automática de PII (`REDACTION_PATHS`).
- Timestamps UTC em persistência; conversão para fuso local só na UI.
- Moeda em centavos inteiros (`BIGINT`), nunca float.
- E-mails de alerta (Resend) passam por whitelist de campos — teste global garante zero PII em alertas.

### Dashboard
- Sidebar categorizada (Operação, Cadastros, Análise, Configurações).
- `/operacao/atendimentos` com filtros + decrypt em bulk dos nomes de pacientes.
- `/cadastros/profissionais` com CRM/council_number, função e especialidade.
- `/cadastros/planos`, `/cadastros/precos` (com fluxo de "nova versão" preservando histórico), `/cadastros/procedimentos`.
- `/analise/relatorios` com agregação mensal + export para Excel.
- `/operacao/pacientes` com busca criptografada (nome + CPF), cadastro manual, ficha clínica e plano de tratamento.
- `/operacao/dlq` + `/operacao/alertas` + `/operacao/auditoria`.

## Feature 002 — Standalone + arquitetura multi-plataforma

### Modo standalone (US1 — P1, MVP)
- **Regra única**: zero linhas ativas em `tenant_integrations` ⇒ modo standalone. A presença da linha é o único sinal — nenhum env var, nenhuma flag global.
- Standalone completo: paciente e atendimento cadastrados **sem nenhuma chamada externa**, **sem alertas** e **sem menções a GHL/HubSpot/etc** na UI. Tempos de cadastro ficam abaixo de 2 s P95.
- Nova rota `POST /api/atendimentos/manual` (admin + recepcionista) e formulário `/operacao/atendimentos/novo` com auto-preenchimento de valor via `/api/precos/vigente`.
- `source='manual'` em `appointments` diferencia da origem webhook; relatórios tratam ambas de forma idêntica.
- Auditoria `appointment.price_override` quando o operador sobrescreve o valor vigente — referência à versão vigente é preservada para rastro.

### Config UI por tenant (US2 — P2)
- Página admin-only `/configuracoes/integracoes` lista todos os providers registrados com badge "Conectado" / "Não configurado".
- `/configuracoes/integracoes/[provider]` renderiza formulário **dinâmico** a partir do JSON Schema vindo da API (cada adapter declara seu `configSchema` e `credentialsSchema` em Zod).
- `GET|POST|DELETE /api/configuracoes/integracoes/[provider]` — Zod dinâmico, credenciais cifradas com `enc_text_with_key`, webhook secret em coluna separada (`webhook_secret_enc`), nunca retorna credenciais em claro.
- Auditoria `integration.{connect,reconfigure,disconnect}` com `reason` obrigatório, credenciais sempre redacted via `adapter.redactCredentials()`.
- Sidebar ganha pills verdes "GHL", "HubSpot", etc. apenas para providers conectados (até 3); para 4+ mostra contador. Zero DOM em tenants standalone.

### Event bus multi-provider (US3 — P3)
- Domain events tipados: `patient.created`, `appointment.created`, `appointment.reversed`.
- `publishDomainEvent` chama `dispatchDomainEvent` que faz fan-out `Promise.allSettled` com timeout 5 s por adapter.
- Falhas geram alerta `integration_sync_failed` com `detail.provider` e `detail.action` — falha em um adapter **não** bloqueia os demais.
- Adapter GHL agora:
  - `patient.created` → `createContactInGhl(ctx)` via proxy Homio-Operations; em sucesso faz UPDATE de `patients.ghl_contact_id`.
  - `appointment.created` → `createNoteInGhl(ctx)` apenas se o paciente tiver `ghl_contact_id` (senão noop success).

### Registry multi-plataforma (Polish)
- `src/lib/integrations/<provider>/adapter.ts` implementa `IntegrationAdapter<Config, Credentials>` (typescript) e é registrado em `src/lib/integrations/registry.ts`.
- Providers vivos hoje: `ghl` (inbound + outbound), `generic_webhook` (outbound para URL configurada com Bearer opcional e filtro de eventos).
- Placeholders: `hubspot/`, `rdstation/`, `pipedrive/` com README detalhando o checklist de implementação.
- Webhook inbound genérico `/api/webhooks/[provider]` delega para `adapter.handleInboundWebhook(supabase, req)`. `/api/webhooks/ghl` permanece como *thin-forward* para back-compat com URLs já configuradas.
- Contract test `tests/contract/integration-adapter.spec.ts` roda contra **todo** adapter do registry — valida label/description, schemas, redactCredentials sem leak (fuzz), handleDomainEvent dentro do budget de 5 s.

### Hardening
- `pnpm lint:auth` estendido: adapters em `src/lib/integrations/**/*.ts` **não podem** ler `process.env.GHL_LOCATION_ID` / `HUBSPOT_*` / `RDSTATION_*` / `PIPEDRIVE_*`. Credenciais chegam via `AdapterContext`.
- Alertas unificados: `ghl_sync_failed` &rarr; `integration_sync_failed` com `provider` em `detail` (migration 0042). Fix para bug latente — o CHECK do banco já rejeitava o valor antigo que o type TS ainda declarava.

### Migrations
- `0040_tenant_integrations.sql` — nova tabela `tenant_integrations (tenant_id, provider)` com RLS admin-write, e backfill a partir de `tenant_ghl_config` para tenants já conectados.
- `0041_drop_tenant_ghl_config.sql` — **NOOP placeholder** (com banner `⚠️ DO NOT APPLY YET`). O drop real aguarda a migração do `create-from-event.ts` para ler field_maps do `tenant_integrations.config`.
- `0042_rename_alert_type.sql` — `ghl_sync_failed` → `integration_sync_failed` + CHECK atualizado.

## Mapa de tabelas tocadas

| Tabela | Estado |
|--------|--------|
| `tenants`, `user_tenants` | Base (001) |
| `procedures`, `health_plans`, `doctors`, `doctor_commission_history` | Base (001) |
| `price_versions` | Append-only versionada (001) |
| `appointments` | Append-only; coluna `source` aceita `'ghl' \| 'manual'` (001) |
| `appointment_reversals` | Append-only (001) |
| `raw_webhook_events`, `webhook_event_transitions` | Pipeline inbound (001) |
| `patients` | PII cifrada, `ghl_contact_id` nullable (001) |
| `audit_log` | Trilha append-only; novos event_types `integration.*` (002) |
| `alerts` | Novo type `integration_sync_failed` (002) |
| `tuss_codes`, `tuss_catalog_versions` | Catálogo ANS multi-tabela 22/19/20 (001) |
| `tenant_ghl_config` | Legado — ainda lido pelo worker (será dropado em PR futuro) |
| **`tenant_integrations`** (NEW) | Fonte-única do modo; RLS admin-write; credenciais cifradas |

## Rotas de API (principais)

| Método | Rota | Role |
|--------|------|------|
| `GET/POST` | `/api/pacientes` | admin, recepcionista |
| `GET/POST` | `/api/pacientes/[id]/…` | idem |
| `GET` | `/api/atendimentos` | todos |
| **`POST`** | **`/api/atendimentos/manual`** (NEW) | admin, recepcionista |
| `POST` | `/api/atendimentos/[id]/reversal` | admin, financeiro |
| `GET` | `/api/precos/vigente` | todos |
| `POST` | `/api/precos` + `/versions` | admin |
| `GET` | `/api/relatorios` + export Excel | admin, financeiro |
| `POST` | `/api/webhooks/ghl` | HMAC (thin-forward) |
| **`POST`** | **`/api/webhooks/[provider]`** (NEW) | HMAC via adapter |
| **`GET`** | **`/api/configuracoes/integracoes`** (NEW) | admin |
| **`GET/POST/DELETE`** | **`/api/configuracoes/integracoes/[provider]`** (NEW) | admin |

## Constitution Check (final)

| Princípio | Status | Evidência |
|-----------|--------|-----------|
| I — Integridade Financeira Imutável | ✅ | Triggers de banco + testes `append-only.spec.ts`; atendimento manual passa pelo mesmo pipeline |
| II — Auditabilidade Total de Preços | ✅ | `audit_log` + `recordIntegrationEvent` + redaction sistêmica |
| III — Isolamento Multi-Tenant | ✅ | RLS + `requireRole` + `tenant-isolation.spec.ts` |
| IV — Conformidade TUSS/ANS | ✅ | Catálogo versionado + `TussCodeRetiredError` no fluxo manual |
| V — Segurança por Perfil (RBAC) | ✅ | `requireRole` em 43 handlers + negações no `audit_log` |

## Test plan

- [x] `pnpm test:integration` — 49 casos passando em 12 suites (standalone, conectado, fan-out, inbound, outbound, tenant-isolation, append-only, webhook-*, patient-encryption)
- [x] `pnpm test:contract` — 17 casos (inclui suite genérica aplicada a cada adapter do registry)
- [x] `pnpm typecheck` — limpo
- [x] `pnpm lint:auth` — 43 handlers autenticados + adapters sem env direto
- [x] `pnpm supabase:reset` — migrations 0001→0042 aplicam em ordem
- [ ] **QA manual** — rodar os 4 cenários de `specs/002-ghl-optional-standalone/quickstart.md` (standalone, conectar GHL, fan-out multi-provider, inbound dinâmico)
- [ ] **Playwright** — `tests/e2e/` cobrindo fluxos principais (pendente — requer dev server)

## Follow-ups conhecidos (não bloqueiam este PR)

1. **Drop `tenant_ghl_config`** — migrar `create-from-event.ts` e `extract-custom-fields.ts` para ler field_maps de `tenant_integrations.config` (requer estender `GhlConfig` com `field_map_patient_*` e backfill). Migration 0041 já está como NOOP placeholder.
2. **Implementar adapters reais** para HubSpot, RD Station, Pipedrive — placeholders documentam o checklist. Registry + event bus já suportam sem mudança no core.
3. **Playwright E2E** rodando em CI com os cenários do `quickstart.md`.
4. **Opportunity** (vs nota) no GHL como opção configurável — hoje só emitimos nota, que é suficiente para o MVP.

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)

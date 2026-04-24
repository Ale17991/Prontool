# Phase 0 — Research & Decisions

**Feature**: GHL Opcional + Modo Standalone + Multi-Plataforma  
**Date**: 2026-04-24

Spec não contém marcadores `[NEEDS CLARIFICATION]`. Os clarifies abaixo cobrem decisões técnicas de implementação e de arquitetura multi-provider.

---

## R-001 — Fonte única de verdade do modo (standalone vs conectado)

**Decision**: Helper `getEnabledIntegrations(supabase, tenantId): Promise<EnabledIntegration[]>` em `src/lib/core/integrations/config.ts`. Retorna lista (possivelmente vazia) de linhas ativas em `tenant_integrations` para o tenant. Lista vazia ⇒ **modo standalone**. Adicionalmente, `getIntegrationConfig(tenantId, provider)` para casos em que um call site precisa de um provider específico (webhook inbound, reconfigure). Cache por request via React `cache()` no server.

**Rationale**: FR-002 exige modo derivado de dados, não de flag. Ao generalizar para *qualquer* integração (não só GHL), "tenant standalone" passa a significar "não tem **nenhuma** integração ativa". Cache per-request elimina queries duplicadas em páginas que checam em múltiplos lugares (layout → sidebar badge → header).

**Alternatives considered**:
- **Coluna `tenants.has_integrations boolean`**: redundante com contagem de `tenant_integrations`. Rejeitado.
- **Manter `tenant_ghl_config` e criar `tenant_hubspot_config` etc.**: multiplica RLS, migrations e código de leitura. Rejeitado.

---

## R-002 — Como `createAppointmentManually` congela preço e comissão sem `raw_webhook_event`

**Decision**: Novo módulo `src/lib/core/appointments/create-manual.ts` recebe `{ tenantId, patientId, doctorId, procedureId, planId, appointmentAt, amountCentsOverride?, observacoes?, actorUserId }`. Usa `resolvePrice` e `resolveCommission` existentes. Insere em `appointments` com `source='manual'`, `source_raw_event_id=NULL`, versões de preço/comissão congeladas. `amountCentsOverride`, se presente, sobrescreve `frozen_amount_cents` e gera audit `appointment.price_override`.

**Rationale**: Reaproveita pipeline append-only. Mantém Principle I (imutabilidade) e II (auditoria de override). Permite override porque spec diz "valor (auto ou manual)".

**Alternatives considered**:
- **Criar `raw_webhook_event` sintético**: poluiria a tabela e violaria semântica. Rejeitado.
- **Não permitir override**: perde flexibilidade do spec. Rejeitado.

---

## R-003 — Payload de `POST /api/atendimentos/manual`

**Decision**: JSON snake_case com `patient_id, doctor_id, procedure_id, plan_id, appointment_at` (ISO UTC), `amount_cents_override?` (int centavos), `observacoes?` (≤500 chars). Vide `contracts/atendimentos-manual.md`.

**Rationale**: Bate com o padrão atual do projeto (`/api/pacientes`, `/api/webhooks/ghl`). Centavos em integer alinha com Constitution §Moeda.

**Alternatives considered**: camelCase (divergente). Aceitar verbo REST genérico `POST /api/atendimentos` (conflita com GET de lista futuro).

---

## R-004 — Estrutura dos endpoints `/api/configuracoes/integracoes`

**Decision**: Dois níveis:

- `GET /api/configuracoes/integracoes` → lista agregada: `[{ provider, connected, connected_since? }, ...]` para todos providers registrados (mesmo os não conectados aparecem com `connected: false`).
- `GET|POST|DELETE /api/configuracoes/integracoes/[provider]` → detalhe + mutações do provider específico. Schema de `config` e `credentials` do POST é validado dinamicamente usando `registry[provider].configSchema` e `credentialsSchema`.

`admin` exclusivo em todos os verbos. Audit `integration.connect`/`disconnect`/`reconfigure` com `provider` no payload.

**Rationale**: UI precisa do agregado para montar a listagem ("GHL: conectado", "HubSpot: não configurado", "RD Station: não configurado"). O handler por `[provider]` isola a validação do payload — cada adapter define seu próprio shape de config (ex.: HubSpot precisa `portal_id` + `private_app_token`, RD Station precisa `client_id`+`client_secret`+`refresh_token`).

**Alternatives considered**:
- **Rotas dedicadas `/api/configuracoes/ghl`, `/api/configuracoes/hubspot`**: duplica auth + estrutura. Rejeitado.
- **Tudo num POST único com campo `provider` no body**: dificulta URL RBAC e logs por provider. Rejeitado.

---

## R-005 — Onde `/api/webhooks/[provider]` decide rejeitar tenants sem aquele provider

**Decision**: Handler genérico em `src/app/api/webhooks/[provider]/route.ts`:

1. Lê `params.provider`. Se não existe em `registry`, retorna 404.
2. Extrai `tenant_id` da requisição (forma depende do provider — em GHL é um header ou query; cada adapter declara `extractTenantIdFromWebhook(request)`).
3. Busca `tenant_integrations` filtrando `(tenant_id, provider)`. Ausente ⇒ 401 `INVALID_SIGNATURE` (sem side-effects, como no plano atual).
4. Presente ⇒ chama `adapter.handleInboundWebhook(ctx, request)` que retorna `Response`.

Mantemos `/api/webhooks/ghl/route.ts` existente apontando para o handler genérico com `params={provider:'ghl'}` (thin forward) por back-compat com URLs já configuradas em clientes.

**Rationale**: FR-010 exige 401 silencioso. Roteamento genérico com back-compat preserva URLs existentes e abre caminho para HubSpot/Pipedrive webhooks sem PR em app routes.

**Alternatives considered**:
- **Manter todas as rotas inbound codificadas (uma por provider)**: duplicação de código de verificação/dispatch. Rejeitado.
- **Um único `/api/webhooks` com discriminador no body**: muitos providers mandam no path; violaria convenção. Rejeitado.

---

## R-006 — Outbound: leitura de credenciais por provider

**Decision**: `AdapterContext` recebido por `adapter.handleDomainEvent(ctx, event)` contém:

```ts
interface AdapterContext {
  tenantId: string;
  provider: ProviderId;
  config: z.infer<Adapter['configSchema']>;      // JSONB público — location_id, portal_id, etc.
  credentials: z.infer<Adapter['credentialsSchema']>; // decrypted em tempo de dispatch
  logger: Logger;                                // pre-bound com tenantId/provider
  now: () => Date;                               // injeção de relógio p/ testes
}
```

`credentials` vem de `tenant_integrations.credentials_enc` (BYTEA cifrado via `enc_text_with_key`), decifrada pelo dispatcher antes de passar ao adapter. Adapter **nunca** lê `process.env.*` — se precisar de chave comum (ex.: chave do proxy Operations compartilhado), lê de uma coluna `shared_secrets_enc` ou de `config`.

**Rationale**: FR-002 exige modo por tenant. Centralizar decrypt no dispatcher evita que cada adapter reimplemente (risco de leak em log). Credenciais passam para o adapter apenas como objeto tipado.

**Alternatives considered**:
- **Env var `SUPABASE_OPERATIONS_URL` global + credencial por tenant**: aceitável para a *URL do proxy* (infra compartilhada), mas o PAT/API key **precisa** ser per-tenant. Decisão: URL do proxy fica em env global, tokens em `credentials_enc` per tenant.
- **Cofre externo (Vault, AWS Secrets Manager)**: overkill para o estágio atual. Pode ser adicionado depois trocando `decryptCredentials()`. Rejeitado agora.

---

## R-007 — Postar "atividade" no provider ao registrar atendimento

**Decision**: Evento `appointment.created` é publicado no event bus após commit. Cada adapter decide como materializar:

- **GHL**: cria **nota** no contato (via proxy `homio-operations` → endpoint `create-contact-note`).
- **HubSpot** *(futuro)*: cria **engagement** (tipo NOTE) no contato.
- **RD Station** *(futuro)*: cria **conversão** customizada.
- **Pipedrive** *(futuro)*: cria **activity**.
- **Generic Webhook**: `POST` para URL configurada com payload JSON padronizado.

Adapter pode implementar subset de eventos — se não sobrescreve `handleDomainEvent` para aquele tipo, é noop. Falha de adapter gera alerta `integration_sync_failed` com `provider` no `detail`; não bloqueia outros adapters (cada adapter roda isolado em `Promise.allSettled`).

**Rationale**: Abstrair em "atividade" (DomainEvent `appointment.created`) deixa a decisão de mapeamento para o adapter. Core permanece puro. `Promise.allSettled` garante que uma integração quebrada não afeta as outras.

**Alternatives considered**:
- **Método específico `createAppointmentNote` na interface**: acopla muito ao vocabulário GHL. Rejeitado.
- **Eventos em fila (QStash) em vez de síncrono**: adiciona latência e complexidade operacional para P2/P3. Fila fica como evolução se fan-out síncrono virar gargalo (>5 providers).

---

## R-008 — UI: badge multi-provider na sidebar

**Decision**: `src/app/(dashboard)/_components/sidebar-integrations-badge.tsx` recebe `integrations: { provider, label }[]` do layout. Quando vazio ⇒ renderiza `null` (zero DOM). Quando 1+ ⇒ renderiza pills agrupadas ("GHL", "HubSpot") ou, se ≥4, um contador ("4 integrações conectadas") com tooltip detalhando.

**Rationale**: FR-003 ("esconder toda menção") aplicada a qualquer plataforma, não só GHL. Pills discretas comunicam status sem virar poluição visual.

**Alternatives considered**:
- **Ícone único "Integrações OK" sem listar**: reduz info útil para o admin. Rejeitado.
- **Banner topo fixo**: invasivo. Rejeitado.

---

## R-009 — Auditoria de conexão/desconexão (multi-provider)

**Decision**: `audit_log` recebe eventos com `provider` no `entity_id`-composto ou em `detail`:

- `event_type`: `'integration.connect' | 'integration.reconfigure' | 'integration.disconnect'`
- `entity_type`: `'tenant_integrations'`
- `entity_id`: string `"<tenant_id>:<provider>"` (para indexação rápida por tenant+provider)
- `before_value`/`after_value`: config **redacted** (credenciais → `'***'`, secrets de webhook → `'***'`)
- `reason`: obrigatório (min 3, max 500)
- `request_ip` + `user_agent` dos headers

**Rationale**: Provider como parte do `entity_id` permite query `WHERE entity_id LIKE '%:ghl'` sem novo índice. Redaction obrigatória cobre todos os providers — redactor é centralizado no módulo `audit/integration-events.ts` e recebe schema `credentialsSchema` do adapter para saber o que mascarar.

**Alternatives considered**:
- **Tabela separada `integration_audit_log`**: fragmenta auditoria; Constitution §II pede trilha unificada. Rejeitado.

---

## R-010 — Interface do adapter (contrato pluggable)

**Decision**: TypeScript interface mínima e estável:

```ts
// src/lib/integrations/types.ts
export type ProviderId = 'ghl' | 'hubspot' | 'rdstation' | 'pipedrive' | 'generic_webhook';

export type DomainEvent =
  | { type: 'patient.created';     patient: PatientSnapshot }
  | { type: 'appointment.created'; appointment: AppointmentSnapshot; patient: PatientSnapshot }
  | { type: 'appointment.reversed'; original: AppointmentSnapshot; reversal: AppointmentSnapshot; reason: string };

export interface AdapterContext<Config = unknown, Credentials = unknown> {
  tenantId: string;
  provider: ProviderId;
  config: Config;
  credentials: Credentials;
  logger: Logger;
  now: () => Date;
}

export interface IntegrationAdapter<Config = unknown, Credentials = unknown> {
  provider: ProviderId;
  label: string;                    // "GoHighLevel", "HubSpot" — mostrado na UI
  description: string;              // frase curta pra UI
  configSchema: z.ZodSchema<Config>;
  credentialsSchema: z.ZodSchema<Credentials>;
  redactCredentials(c: Credentials): Record<string, string>;       // p/ audit_log
  extractTenantIdFromWebhook?(req: Request): Promise<string | null>; // inbound
  handleInboundWebhook?(ctx: AdapterContext<Config, Credentials>, req: Request): Promise<Response>;
  handleDomainEvent(ctx: AdapterContext<Config, Credentials>, event: DomainEvent): Promise<void>;
}
```

Registry:

```ts
// src/lib/integrations/registry.ts
import { ghlAdapter } from './ghl/adapter';
import { genericWebhookAdapter } from './generic-webhook/adapter';
export const registry: Record<ProviderId, IntegrationAdapter<any, any>> = {
  ghl: ghlAdapter,
  generic_webhook: genericWebhookAdapter,
  // hubspot: ..., rdstation: ..., pipedrive: ...
};
```

**Rationale**: Interface minimalista: 2 métodos obrigatórios (`handleDomainEvent`, `redactCredentials`) e 2 opcionais (inbound webhook). `AdapterContext` bate com padrão de "ports and adapters" / hexagonal architecture — core publica evento, adapter consome. `redactCredentials` garante que auditoria nunca leaks e é de responsabilidade de quem conhece o shape das credenciais.

**Alternatives considered**:
- **Classe abstrata com `super()`**: mais pesado em TS; dificulta mocking. Rejeitado.
- **Métodos específicos por evento (`onPatientCreated`, `onAppointmentCreated`)**: N métodos à medida que domínio cresce. Discriminated union é mais extensível. Rejeitado.
- **Plugin descoberto em runtime (dynamic import por provider id)**: adiciona complexidade de build sem ganho. Registry estático é mais simples e typável. Rejeitado.

---

## R-011 — Contract test genérico para adapters

**Decision**: `tests/contract/integration-adapter.spec.ts` roda a mesma suite contra **todos** adapters registrados:

- Schema validation (config e credentials válidos passam; inválidos rejeitam).
- `redactCredentials` não retorna valores originais (fuzz com strings "supersecret" → garantia de `'***'` ou equivalente).
- `handleDomainEvent` não lança em evento não-suportado (noop).
- `handleDomainEvent` nunca consome > 5s (timeout interno).

**Rationale**: Qualquer novo adapter precisa passar antes de ser mergeado. Garante consistência de comportamento (principalmente redaction e timeout).

---

## R-012 — Event bus: síncrono vs assíncrono

**Decision**: Fan-out **síncrono** em P3 dentro do request (com `Promise.allSettled` e timeout por adapter). Em P4, se necessário, promover para fila Upstash QStash publicando `integration_events` em tabela append-only consumida por worker.

**Rationale**: Síncrono é mais simples de observar/testar/reverter. Latência aceitável para ≤ 3 adapters em paralelo. Se virar gargalo (timeout do request ou 5+ providers), ficamos prontos para fila — o event bus abstrai o "como" do "o quê".

**Alternatives considered**:
- **Fila desde P3**: adiciona superfície (infra QStash, worker, visibility). Principalmente, atrasa sinal para o operador ("contato aparece no GHL em 30s" vira "em 2 min"). Rejeitado para P3, reconsideramos em P4.

---

## Unknowns remaining

Nenhum. Todos os pontos de decisão para Phase 1 (data-model, contratos, quickstart) estão cobertos.

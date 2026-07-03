# Implementation Plan: GHL Opcional + Modo Standalone + Multi-Plataforma

**Branch**: `002-ghl-optional-standalone` | **Date**: 2026-04-24 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-ghl-optional-standalone/spec.md`

## Summary

Tornar o Prontool 100% utilizável sem nenhuma integração externa e, ao mesmo tempo, **abrir** a arquitetura para conectar a **múltiplas plataformas** (CRM/marketing: GHL, HubSpot, RD Station, Pipedrive, e webhook genérico) de forma pluggable. GHL é apenas o primeiro provider do registry.

Princípios da arquitetura:

- **Provider-agnostic core**: paciente, atendimento, comissão e relatórios **não conhecem** nenhum CRM. Eles emitem eventos de domínio (`patient.created`, `appointment.created`, `appointment.reversed`).
- **Adapter registry**: cada plataforma implementa `IntegrationAdapter` em `src/lib/integrations/<provider>/adapter.ts` e é registrada em `src/lib/integrations/registry.ts`. Adicionar um novo provider = novo diretório + registro (sem tocar no core).
- **Estado por tenant × provider**: a tabela nova `tenant_integrations` (PK `(tenant_id, provider)`) armazena config + credenciais cifradas. Zero linhas ativas para um tenant ⇒ modo standalone.
- **Fan-out event bus**: criação de paciente/atendimento publica um evento; um dispatcher percorre integrações habilitadas do tenant e chama o adapter. Falhas são best-effort com alerta `integration_sync_failed` (antes `ghl_sync_failed`).
- **Webhooks inbound genéricos**: endpoint dinâmico `/api/webhooks/[provider]/route.ts` delega para `adapter.handleInboundWebhook()`. Cada adapter valida assinatura, normaliza payload e cria atendimento via core.
- **UI simétrica**: `/configuracoes/integracoes` lista todos os providers com status individual. Ausência de qualquer integração ativa ⇒ sidebar e dashboard sem nenhuma menção a plataformas externas.

Ordem de entrega:

- **P1 (standalone parity)**: rota `POST /api/atendimentos/manual` + core `createAppointmentManually` + UI "Novo atendimento". Zero dependência de integrações. Entrega **sem** depender do adapter registry — apenas garante que o path standalone funcione.
- **P2 (adapter registry + config UI)**: infraestrutura multi-provider; tela `/configuracoes/integracoes` e rota `/api/configuracoes/integracoes/[provider]` (GET/POST/DELETE). GHL é o primeiro adapter implementado, mapeando o fluxo atual.
- **P3 (outbound fan-out)**: event bus dispara `patient.created` e `appointment.created` após INSERT. Dispatcher percorre integrações ativas do tenant e chama `adapter.handleDomainEvent()`. Falhas geram alerta.
- **P4 (migração de webhook)**: `/api/webhooks/ghl` continua válido (redireciona para `/api/webhooks/ghl`-via-registry); adiciona suporte a `/api/webhooks/[provider]` genérico.

## Technical Context

**Language/Version**: TypeScript 5.4+ sobre Node.js 20 LTS (runtime Vercel)  
**Primary Dependencies**: Next.js 14.2 (App Router), `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23 (configs de adapter validados via schema), Pino 9, React 18.3, Radix UI, TailwindCSS 3.4. Sem novas deps — usamos Zod para validar config per-adapter e `fetch` nativo para HTTP outbound.  
**Storage**: PostgreSQL via Supabase (local: `supabase start` :54321) com RLS por `tenant_id`. Novas tabelas: `tenant_integrations` (substitui `tenant_ghl_config`), `integration_events` (event log append-only, opcional em P3). Tabelas tocadas: `patients`, `appointments`, `audit_log`, `alerts`. Migração 0040 cria `tenant_integrations` e copia dados de `tenant_ghl_config`; 0041 dropa a tabela antiga após deploy.  
**Testing**: Vitest (unit/integration/contract em `tests/`), Playwright (E2E). MSW para simular providers externos em integration tests. Cada adapter tem sua suíte isolada (`tests/integration/integrations/<provider>/*.spec.ts`) + a suíte genérica de contrato do registry (`tests/contract/integration-adapter.spec.ts`).  
**Target Platform**: Web (navegador moderno, desktop-first) servido por Vercel edge/Node runtime.  
**Project Type**: Aplicação web Next.js monorepo único — `src/app` para rotas, `src/lib` para domínio + integrações, `supabase/migrations` para schema.  
**Performance Goals**: Criação de paciente/atendimento manual em tenant standalone < 2 s P95 (sem fan-out). Em tenant conectado: fan-out síncrono com timeout agregado < 8 s P95; cada adapter tem timeout individual de 5 s. Sync bem-sucedido reflete em 95% dos casos no provider em ≤ 30 s.  
**Constraints**: Zero regressão no webhook GHL atual. RLS/RBAC em todas as rotas. PII via `enc_text_with_key`. Financeiro append-only (Principle I). Moeda em centavos. **Credenciais de adapters sempre cifradas** — nenhum adapter pode ler `process.env.*_SECRET`/`*_KEY` diretamente; devem ler da linha `tenant_integrations.credentials_enc`.  
**Scale/Scope**: Dezenas de tenants, até ~5 providers ativos por tenant em t+12m. Cerca de 12 arquivos novos em `src/lib/integrations/`, 4 rotas novas de API, 2 páginas novas, 1 migration (mais 1 de cleanup em P4).

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Princípio                              | Aplicação nesta feature                                                                                                                                                                                                                                                | Status  |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| **I. Integridade Financeira Imutável** | Atendimentos manuais seguem INSERT append-only em `appointments`; estornos via rota existente. Event bus **observa** criação (após commit), nunca muta histórico.                                                                                                      | ✅ PASS |
| **II. Auditabilidade Total de Preços** | Eventos `integration.connect`/`disconnect`/`reconfigure` em `audit_log` (provider-agnóstico, com campo `provider` no payload). Falhas de sync vão para `alerts` com `provider` no `detail`. Override de preço em atendimento manual gera `appointment.price_override`. | ✅ PASS |
| **III. Isolamento Multi-Tenant**       | `tenant_integrations` tem RLS `tenant_id = current_tenant_id()` e `admin` write. Dispatcher sempre filtra por `tenant_id` da sessão ao fan-out. Adapter recebe `AdapterContext { tenantId, config, credentials }` — não tem acesso a outros tenants.                   | ✅ PASS |
| **IV. Conformidade TUSS/ANS**          | Fluxo manual valida via `resolvePrice` → `TussCodeRetiredError`. Adapters inbound (webhook → atendimento) continuam passando pelo mesmo validador.                                                                                                                     | ✅ PASS |
| **V. RBAC**                            | `admin` only para `/api/configuracoes/integracoes/[provider]`. `admin`+`recepcionista` para `/api/atendimentos/manual`. Negações em `audit_log`.                                                                                                                       | ✅ PASS |

**Resultado**: GATE PASS. Nenhuma violação. Complexity Tracking abaixo fica vazio.

## Project Structure

### Documentation (this feature)

```text
specs/002-ghl-optional-standalone/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output — multi-provider decisions
├── data-model.md        # Phase 1 output — tenant_integrations + adapter iface
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── atendimentos-manual.md
│   ├── pacientes.md
│   ├── integracoes.md              # generic provider GET/POST/DELETE
│   └── integration-adapter.md      # TS interface contract all adapters MUST satisfy
└── tasks.md             # Phase 2 (/speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── app/
│   ├── (dashboard)/
│   │   ├── _components/
│   │   │   └── sidebar-integrations-badge.tsx    # NEW — pills de providers conectados
│   │   ├── configuracoes/
│   │   │   ├── page.tsx                          # EXISTING — link para integracoes
│   │   │   └── integracoes/
│   │   │       ├── page.tsx                      # NEW — lista todos providers
│   │   │       └── [provider]/
│   │   │           └── page.tsx                  # NEW — detalhe + form connect/disconnect
│   │   └── operacao/
│   │       └── atendimentos/
│   │           ├── page.tsx                      # EXISTING — adicionar botão "Novo"
│   │           └── novo/
│   │               └── page.tsx                  # NEW — form manual
│   └── api/
│       ├── atendimentos/
│       │   ├── route.ts                          # EXISTING
│       │   ├── manual/
│       │   │   └── route.ts                      # NEW — POST
│       │   └── [id]/...                          # EXISTING
│       ├── configuracoes/
│       │   └── integracoes/
│       │       ├── route.ts                      # NEW — GET lista status agregado
│       │       └── [provider]/
│       │           └── route.ts                  # NEW — GET/POST/DELETE por provider
│       └── webhooks/
│           ├── ghl/route.ts                      # EXISTING — mantido por back-compat
│           └── [provider]/
│               └── route.ts                      # NEW — roteamento dinâmico pelo registry
├── lib/
│   ├── core/
│   │   ├── appointments/
│   │   │   ├── create-from-event.ts              # EXISTING (GHL inbound)
│   │   │   ├── create-manual.ts                  # NEW — standalone path
│   │   │   └── reverse.ts
│   │   ├── patients/create-manual.ts             # EXISTING — remover GHL direto; emitir evento
│   │   ├── events/
│   │   │   ├── types.ts                          # NEW — DomainEvent discriminated union
│   │   │   ├── publish.ts                        # NEW — publishDomainEvent(supabase, event)
│   │   │   └── dispatch.ts                       # NEW — fan-out para adapters habilitados
│   │   ├── integrations/
│   │   │   ├── config.ts                         # NEW — getEnabledIntegrations(tenantId)
│   │   │   └── credentials.ts                    # NEW — decrypt credentials per provider
│   │   └── audit/
│   │       └── integration-events.ts             # NEW — record integration.{connect,disconnect,reconfigure}
│   └── integrations/
│       ├── types.ts                              # NEW — IntegrationAdapter, AdapterContext, DomainEvent
│       ├── registry.ts                           # NEW — all adapters registered here
│       ├── ghl/
│       │   ├── adapter.ts                        # NEW — implements IntegrationAdapter
│       │   ├── create-contact.ts                 # EXISTING (refactor p/ receber credentials)
│       │   ├── create-note.ts                    # NEW
│       │   ├── extract-custom-fields.ts          # EXISTING
│       │   └── verify-signature.ts               # EXISTING (refactor p/ usar secret do adapter ctx)
│       ├── hubspot/                              # FUTURE — placeholder diretório
│       ├── rdstation/                            # FUTURE
│       ├── pipedrive/                            # FUTURE
│       └── generic-webhook/                      # NEW (P2 mínimo) — fire POST to a user-configured URL

tests/
├── contract/
│   ├── atendimentos-manual.spec.ts               # NEW
│   ├── integracoes.spec.ts                       # NEW
│   └── integration-adapter.spec.ts               # NEW — suite abstrata que TODO adapter precisa passar
├── integration/
│   ├── standalone-flow.spec.ts                   # NEW — P1 sem nenhuma integração
│   ├── integrations/
│   │   ├── ghl/
│   │   │   ├── connect-disconnect.spec.ts        # NEW — P2
│   │   │   ├── outbound-sync.spec.ts             # NEW — P3
│   │   │   └── inbound-webhook.spec.ts           # NEW — regressão P4
│   │   └── generic-webhook/
│   │       └── outbound.spec.ts                  # NEW — smoke do provider genérico
│   └── event-dispatch.spec.ts                    # NEW — fan-out para múltiplos adapters
└── e2e/
    └── standalone-no-integrations-ui.spec.ts     # NEW — grep ausência de GHL/HubSpot/etc na UI standalone
```

**Structure Decision**: Mantemos a estrutura monolítica do Next.js App Router. A novidade é o diretório `src/lib/integrations/<provider>/` — cada provider é auto-contido (adapter + HTTP helpers + schemas). O `registry.ts` é o único ponto de "plug-in". Código de domínio (`src/lib/core/**`) **nunca** importa de `src/lib/integrations/<provider>/*` diretamente — só do event bus e do registry. Essa direção de dependência é o que permite adicionar providers sem tocar no core e garante que o modo standalone seja literalmente "registry retorna lista vazia de integrações ativas → dispatcher não faz nada".

## Complexity Tracking

> Nenhuma violação da constituição a justificar. A abstração do adapter registry é um **design principle**, não um desvio — ela simplifica o core ao invés de complicá-lo.

| Violation | Why Needed | Simpler Alternative Rejected Because |
| --------- | ---------- | ------------------------------------ |
| —         | —          | —                                    |

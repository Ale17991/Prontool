# Quickstart — GHL Opcional + Standalone + Multi-Plataforma

Guia para desenvolver, testar e validar esta feature localmente.

## Pré-requisitos

- Node.js 20 LTS, pnpm 9.5.
- Docker em execução (para Supabase local).
- Supabase CLI.

## Setup

```bash
pnpm install
pnpm supabase:start          # Postgres em :54321
pnpm supabase:reset          # aplica migrations, inclusive 0040 (tenant_integrations) e 0041 (drop tenant_ghl_config)
pnpm seed:demo               # tenant demo sem nenhuma integração (standalone por default)
```

`.env.local`:

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=<output do supabase start>
SUPABASE_SERVICE_ROLE_KEY=<output do supabase start>
PATIENT_DATA_ENCRYPTION_KEY=<32+ chars random>
# URL do proxy Homio-Operations (compartilhado entre tenants):
SUPABASE_OPERATIONS_URL=http://127.0.0.1:54321
SUPABASE_OPERATIONS_ANON_KEY=<anon key>
# NENHUM token de provider é global — todos vêm de tenant_integrations.credentials_enc.
```

Rode: `pnpm dev` → http://localhost:3000.

## Providers suportados (registry)

Ao mergear esta feature, o registry em `src/lib/integrations/registry.ts` expõe:

| Provider          | Status                              | Inbound webhook        | Outbound                           |
| ----------------- | ----------------------------------- | ---------------------- | ---------------------------------- |
| `ghl`             | **Shipped**                         | ✅ `/api/webhooks/ghl` | ✅ `create-contact`, `create-note` |
| `generic_webhook` | **Shipped**                         | —                      | ✅ POST JSON para URL configurada  |
| `hubspot`         | _placeholder dir, não implementado_ | —                      | —                                  |
| `rdstation`       | _placeholder dir, não implementado_ | —                      | —                                  |
| `pipedrive`       | _placeholder dir, não implementado_ | —                      | —                                  |

Novos providers seguem o checklist em [contracts/integration-adapter.md](./contracts/integration-adapter.md).

## Scenário 1 — Standalone (P1)

Objetivo: validar SC-001, SC-002, SC-006.

1. Login como `admin@demo.com` (tenant demo não tem linhas em `tenant_integrations`).
2. Navegar pelo dashboard → sidebar **sem** badges de integração; nenhuma menção a "GHL", "HubSpot", "integração pendente".
3. `/cadastros/pacientes` → **Novo paciente** → preencher e salvar.
   - Resposta < 2 s.
   - DevTools Network: **nenhuma** chamada outbound.
   - `integrations_dispatched: []` na resposta JSON.
   - `select count(*) from alerts where tenant_id=<demo>` = 0.
4. `/operacao/atendimentos` → **Novo atendimento** → formulário manual.
   - Salvar → aparece na listagem, entra em comissão, entra no relatório.
5. Grep no DOM (E2E): zero ocorrências de "GHL", "HubSpot", "integração".

## Scenário 2 — Conectar GHL (P2)

Objetivo: validar SC-004 e o caminho "primeiro provider conectado".

1. Login como admin.
2. `/configuracoes/integracoes` → lista todos os providers, GHL com badge "Não configurado".
3. Clicar em "GoHighLevel" → `/configuracoes/integracoes/ghl`.
4. Preencher (schema vindo do `config_schema` da API):
   - Location ID: `abc123XYZ789abc12345`.
   - Trigger stage: `Pagamento confirmado`.
   - 4 field maps.
5. Credentials:
   - `operations_pat`: `pit-local-dev-token`.
   - `inbound_webhook_secret`: string 32+ chars.
6. Reason: `Teste local`.
7. **Conectar** → badge muda. Sidebar passa a mostrar pill "GHL" (verde).
8. `select event_type, reason from audit_log where entity_id='<tenant>:ghl' order by created_at desc limit 1` → `integration.connect`.
9. **Desconectar** com reason → badge volta para "Não configurado"; audit `integration.disconnect`.

### Role check

Logar como `recepcionista@demo.com` → acessar `/configuracoes/integracoes` → 403 / redirect.

## Scenário 3 — Conectar múltiplos providers + fan-out (P3)

Objetivo: validar arquitetura multi-provider.

1. Tenant com **GHL** + **generic_webhook** ambos conectados.
   - GHL apontando para o mock local do proxy (`:54322`).
   - generic_webhook apontando para `http://localhost:4000/prontool-events` (qualquer servidor de sua escolha).
2. Cadastrar paciente manual:
   - Response: `integrations_dispatched: [{ provider: 'ghl', ok: true, ... }, { provider: 'generic_webhook', ok: true, ... }]`.
   - Mock GHL recebe `POST /functions/v1/create-contact`.
   - Server em `:4000` recebe `POST /prontool-events` com body `{ event: 'patient.created', patient: {...} }`.
3. Derrubar o server `:4000` e cadastrar outro paciente:
   - Response: `integrations_dispatched: [{ provider: 'ghl', ok: true }, { provider: 'generic_webhook', ok: false, detail: 'ECONNREFUSED' }]`.
   - Paciente persistido normalmente.
   - Alerta `integration_sync_failed` criado somente com `detail.provider='generic_webhook'`. Nenhum alerta para GHL.
4. Registrar atendimento manual:
   - GHL cria nota no contato.
   - generic_webhook recebe `POST /prontool-events` com `{ event: 'appointment.created', appointment: {...}, patient: {...} }`.

## Scenário 4 — Webhook inbound multi-provider (P4)

Objetivo: rota dinâmica funciona + `/api/webhooks/ghl` continua compatível.

1. Tenant com GHL conectado.
2. `pnpm simulate:webhook` (script existente) → chega em `/api/webhooks/ghl` → delega para roteador genérico → `ghlAdapter.handleInboundWebhook` → atendimento criado.
3. Chamar `POST /api/webhooks/ghl` sem assinatura → 401 (inalterado).
4. Chamar `POST /api/webhooks/bogus-provider` → 404 `PROVIDER_NOT_FOUND`.
5. Chamar `POST /api/webhooks/ghl` para tenant **sem** GHL conectado → 401 `INVALID_SIGNATURE` (ausência da linha é indistinguível de secret inválido do ponto de vista do chamador).

## Testes automatizados

```bash
pnpm test:contract       # atendimentos-manual, integracoes, integration-adapter (aplicado a TODO adapter)
pnpm test:integration    # fluxos standalone + connected + multi-provider
pnpm test:e2e            # Playwright: ausência de menções a providers em standalone
```

Específicos:

```bash
pnpm vitest tests/integration/standalone-flow.spec.ts
pnpm vitest tests/integration/integrations/ghl
pnpm vitest tests/integration/integrations/generic-webhook
pnpm vitest tests/integration/event-dispatch.spec.ts
pnpm vitest tests/contract/integration-adapter.spec.ts
pnpm playwright test tests/e2e/standalone-no-integrations-ui.spec.ts
```

## Adicionando um novo provider (ex.: HubSpot)

1. `mkdir src/lib/integrations/hubspot`
2. Criar `adapter.ts` implementando `IntegrationAdapter` (vide [contracts/integration-adapter.md](./contracts/integration-adapter.md)).
3. Adicionar `hubspot` ao `ProviderId` em `src/lib/integrations/types.ts` e ao registry.
4. Nova migration `00NN_add_provider_hubspot.sql` ajustando o CHECK de `tenant_integrations.provider`.
5. Teste em `tests/integration/integrations/hubspot/*.spec.ts`.
6. Rodar `pnpm test:contract` — suíte genérica passa.
7. Atualizar a tabela de providers suportados neste quickstart.

## Troubleshooting

| Sintoma                                        | Causa provável                                       | Fix                                 |
| ---------------------------------------------- | ---------------------------------------------------- | ----------------------------------- |
| `PATIENT_DATA_ENCRYPTION_KEY is required`      | Env faltando                                         | `.env.local`                        |
| `RLS policy denies` ao conectar                | Não logado como admin                                | Logar como admin                    |
| Tenant standalone mostra "GHL" na UI           | Client component renderiza antes do server bootstrap | `dynamic='force-dynamic'` no layout |
| `PROVIDER_NOT_FOUND` 404 em endpoint existente | ProviderId não está no registry                      | Conferir `registry.ts`              |
| Adapter timeout todo request                   | `handleDomainEvent` sem `AbortSignal.timeout`        | Adicionar timeout ao `fetch`        |

## Links úteis

- Spec: [spec.md](./spec.md)
- Plan: [plan.md](./plan.md)
- Research: [research.md](./research.md)
- Data model: [data-model.md](./data-model.md)
- Contracts: [contracts/](./contracts/)
  - [atendimentos-manual.md](./contracts/atendimentos-manual.md)
  - [pacientes.md](./contracts/pacientes.md)
  - [integracoes.md](./contracts/integracoes.md)
  - [integration-adapter.md](./contracts/integration-adapter.md)
